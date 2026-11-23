import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { AiService } from 'src/ai/service/ai.service';
import { LoggerService } from 'src/logger/logger.service';
import {
  CL_LOOP_WINDOW_DAYS,
  CL_MERGE_MIN_CO_SURFACED,
  CL_MERGE_SIMILARITY,
} from '../constants/context-library.constants';
import { ClChunk } from '../entity/cl-chunk.entity';
import {
  ClChunkConfidence,
  ClChunkOrigin,
  ClChunkStatus,
  ClLoop,
  ClLoopActionType,
} from '../enum/context-library.enum';
import { requireProfile } from '../profiles';
import { sameAudience } from '../util/audience.util';
import {
  CuratorStats,
  MAX_LEARNED_QUERIES,
  QUERY_LEARNING_MISSED_RANK,
  USE_WEIGHTS,
  cosine,
  curatorDecision,
  effectivenessScore,
  neverUseful,
} from '../util/loops.util';
import { ContextChunkService } from './context-chunk.service';
import { ContextLlmService } from './context-llm.service';
import { ContextLoopActionsService } from './context-loop-actions.service';

export interface CuratorRow extends CuratorStats {
  id: string;
  code: string;
  statement: string;
  /** The organisation that owns it; null for the platform's own. */
  ownerTenantId?: string | null;
}

/**
 * The loops that change chunks, all driven by usage and the judge — never by anyone's rating:
 *
 * - **Query learning:** a wording that found a useful chunk only by luck (the situations vector
 *   ranked it below 20) becomes one of that chunk's learned example queries, so the next person
 *   who phrases it that way finds it directly. Never from sensitive queries (a person's own
 *   words), never from the holdout, at most ten per chunk.
 * - **Effectiveness:** a position-corrected, smoothed use rate that the retrieval service uses
 *   as a ±10% prior within a band.
 * - **Curator:** archives, demotes and promotes distilled chunks, and merges near-duplicates that
 *   keep being shown together. Authored, imported and synced text belongs to its author or
 *   source table, so for those it only reports.
 */
@Injectable()
export class ContextLearningService {
  private readonly logger = LoggerService.getInstance(
    ContextLearningService.name,
  );

  constructor(
    private readonly dataSource: DataSource,
    private readonly ai: AiService,
    private readonly llm: ContextLlmService,
    private readonly actions: ContextLoopActionsService,
    private readonly chunkService: ContextChunkService,
    @InjectRepository(ClChunk) private readonly chunks: Repository<ClChunk>,
  ) {}

  // ── Query learning ──────────────────────────────────────────────────────────

  async learnQueries(collectionId: string): Promise<number> {
    const rows: Array<{
      chunk_id: string;
      queries: string[];
      grade: number;
    }> = await this.dataSource.query(
      `SELECT j.chunk_id, r.queries, j.grade
       FROM cl_judgments j
       JOIN cl_retrievals r ON r.id = j.retrieval_id
       JOIN cl_retrieval_hits h ON h.retrieval_id = j.retrieval_id AND h.chunk_id = j.chunk_id
       WHERE j.collection_id = $1 AND j.split = 'learn' AND j.grade >= 2
         AND NOT r.query_sensitive AND NOT r.exclude_from_usage
         AND (h.situations_rank IS NULL OR h.situations_rank > $2)
         AND j."createdAt" > now() - interval '7 days'`,
      [collectionId, QUERY_LEARNING_MISSED_RANK],
    );
    if (!rows.length) return 0;
    const chunkRows = await this.chunks.find({
      where: {
        id: In([...new Set(rows.map((r) => r.chunk_id))]),
        status: ClChunkStatus.ACTIVE,
      },
    });
    const byId = new Map(chunkRows.map((c) => [c.id, c]));
    let learned = 0;
    for (const row of rows) {
      const chunk = byId.get(row.chunk_id);
      if (!chunk) continue;
      const query = await this.closestQuery(row.queries, chunk);
      if (!query) continue;
      const lower = query.toLowerCase();
      const existing = chunk.exampleQueries ?? [];
      const rejected = new Set(
        ((chunk.quality as any)?.rejectedQueries ?? []) as string[],
      );
      if (
        rejected.has(lower) ||
        existing.some((q) => q.text.toLowerCase() === lower) ||
        existing.filter((q) => q.origin === 'learned').length >=
          MAX_LEARNED_QUERIES
      )
        continue;
      const before = { exampleQueries: existing };
      chunk.exampleQueries = [...existing, { text: query, origin: 'learned' }];
      await this.chunkService.saveChanged(chunk, 'learned query', null);
      await this.actions.record({
        collectionId,
        loop: ClLoop.QUERY_LEARNING,
        action: ClLoopActionType.LEARN_QUERY,
        chunkId: chunk.id,
        reason: `Learned “${query}” for ${chunk.code}: judged useful, but that wording only found it by luck`,
        before,
        after: { query },
        evidence: { grade: row.grade },
      });
      learned++;
    }
    return learned;
  }

  /** Which of a search's queries this chunk answers — the one nearest its statement. */
  private async closestQuery(
    queries: string[],
    chunk: ClChunk,
  ): Promise<string | null> {
    const clean = (queries ?? [])
      .map((q) => q.trim())
      .filter((q) => q.length >= 6 && q.length <= 200);
    if (clean.length <= 1) return clean[0] ?? null;
    try {
      const embedded = await this.ai.contextEmbed([chunk.statement, ...clean]);
      const [target, ...vectors] = embedded?.vectors ?? [];
      if (!target || vectors.length !== clean.length) return null;
      let best = 0;
      vectors.forEach((v, i) => {
        if (cosine(v, target) > cosine(vectors[best], target)) best = i;
      });
      return clean[best];
    } catch {
      return null;
    }
  }

  // ── Effectiveness ───────────────────────────────────────────────────────────

  async recomputeEffectiveness(collectionId: string): Promise<number> {
    const rows: Array<{
      chunk_id: string;
      type: string;
      n: string;
      exposure: string | null;
    }> = await this.dataSource.query(
      `SELECT chunk_id, type, count(*) AS n,
              SUM(CASE WHEN type = 'surfaced' THEN 1.0 / (ln(COALESCE(final_rank, 8) + 1) / ln(2)) END) AS exposure
       FROM cl_usage_events
       WHERE collection_id = $1 AND "createdAt" > now() - ($2 || ' days')::interval
       GROUP BY chunk_id, type`,
      [collectionId, String(CL_LOOP_WINDOW_DAYS)],
    );
    const acc = new Map<string, { uses: number; exposure: number }>();
    for (const r of rows) {
      const entry = acc.get(r.chunk_id) ?? { uses: 0, exposure: 0 };
      if (r.type === 'surfaced') entry.exposure += Number(r.exposure ?? 0);
      else entry.uses += (USE_WEIGHTS[r.type] ?? 0) * Number(r.n);
      acc.set(r.chunk_id, entry);
    }
    if (!acc.size) return 0;
    const ids = [...acc.keys()];
    const values = ids.map((id) =>
      effectivenessScore(acc.get(id)!.uses, acc.get(id)!.exposure),
    );
    await this.dataSource.query(
      `UPDATE cl_chunks c SET effectiveness = v.e
       FROM (SELECT unnest($1::uuid[]) AS id, unnest($2::real[]) AS e) v
       WHERE c.id = v.id`,
      [ids, values],
    );
    return ids.length;
  }

  // ── Curator ─────────────────────────────────────────────────────────────────

  async curatorStats(collectionId: string): Promise<CuratorRow[]> {
    const rows: any[] = await this.dataSource.query(
      `SELECT c.id, c.code, c.statement, c.origin, c.confidence, c.pinned, c.owner_tenant_id,
              COALESCE(u.surfaced, 0) AS surfaced, COALESCE(u.applied, 0) AS applied,
              COALESCE(u.cited, 0) AS cited,
              COALESCE(j.judged, 0) AS judged, COALESCE(j.off_topic, 0) AS off_topic,
              COALESCE(j.useful, 0) AS useful
       FROM cl_chunks c
       LEFT JOIN (
         SELECT chunk_id,
                count(*) FILTER (WHERE type = 'surfaced') AS surfaced,
                count(*) FILTER (WHERE type IN ('applied_verified', 'agent_applied', 'shipped')) AS applied,
                count(*) FILTER (WHERE type = 'cited') AS cited
         FROM cl_usage_events
         WHERE collection_id = $1 AND "createdAt" > now() - ($2 || ' days')::interval
         GROUP BY chunk_id) u ON u.chunk_id = c.id
       LEFT JOIN (
         SELECT chunk_id, count(*) AS judged,
                count(*) FILTER (WHERE grade <= 1) AS off_topic,
                count(*) FILTER (WHERE grade >= 2) AS useful
         FROM cl_judgments
         WHERE collection_id = $1 AND split = 'learn'
           AND "createdAt" > now() - ($2 || ' days')::interval
         GROUP BY chunk_id) j ON j.chunk_id = c.id
       WHERE c.collection_id = $1 AND c.status = 'active'`,
      [collectionId, String(CL_LOOP_WINDOW_DAYS)],
    );
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      statement: r.statement,
      origin: r.origin,
      confidence: r.confidence,
      pinned: Boolean(r.pinned),
      ownerTenantId: r.owner_tenant_id ?? null,
      surfaced: Number(r.surfaced),
      applied: Number(r.applied),
      cited: Number(r.cited),
      judged: Number(r.judged),
      judgedOffTopic: Number(r.off_topic),
      judgedUseful: Number(r.useful),
    }));
  }

  async curate(collectionId: string): Promise<number> {
    const stats = await this.curatorStats(collectionId);
    let changed = 0;
    const overruled = new Map<ClLoopActionType, Set<string>>();
    for (const type of [
      ClLoopActionType.ARCHIVE,
      ClLoopActionType.DEMOTE,
      ClLoopActionType.PROMOTE,
    ]) {
      overruled.set(type, await this.actions.overruled(collectionId, type));
    }
    for (const s of stats) {
      const decision = curatorDecision(s);
      if (!decision || overruled.get(decision.action)?.has(s.id)) continue;
      const chunk = await this.chunks.findOne({ where: { id: s.id } });
      if (!chunk || chunk.status !== ClChunkStatus.ACTIVE) continue;
      const before = { status: chunk.status, confidence: chunk.confidence };
      await this.chunkService.snapshot(
        chunk,
        `curator: ${decision.action}`,
        null,
      );
      if (decision.action === ClLoopActionType.ARCHIVE)
        chunk.status = ClChunkStatus.ARCHIVED;
      if (decision.action === ClLoopActionType.DEMOTE)
        chunk.confidence = ClChunkConfidence.LOW;
      if (decision.action === ClLoopActionType.PROMOTE)
        chunk.confidence = ClChunkConfidence.STANDARD;
      await this.chunkService.saveChanged(
        chunk,
        `curator: ${decision.action}`,
        null,
      );
      await this.actions.record({
        collectionId,
        loop: ClLoop.CURATOR,
        action: decision.action,
        chunkId: chunk.id,
        reason: `${chunk.code}: ${decision.reason}`,
        before,
        after: { status: chunk.status, confidence: chunk.confidence },
        evidence: {
          surfaced: s.surfaced,
          judged: s.judged,
          judgedOffTopic: s.judgedOffTopic,
          judgedUseful: s.judgedUseful,
          applied: s.applied,
          cited: s.cited,
        },
      });
      changed++;
    }
    changed += await this.mergeCoSurfaced(collectionId);
    return changed;
  }

  /** Written entries that never help, for their owners. The loops never change them. */
  /** With `ownerTenantId`, only that organisation's own entries (its admins' "For owners"). */
  async neverUsefulEntries(collectionId: string, ownerTenantId?: string) {
    const stats = await this.curatorStats(collectionId);
    return stats
      .filter((s) => !ownerTenantId || s.ownerTenantId === ownerTenantId)
      .filter(neverUseful)
      .map((s) => ({
        code: s.code,
        statement: s.statement,
        origin: s.origin,
        surfaced: s.surfaced,
        judged: s.judged,
        judgedOffTopic: s.judgedOffTopic,
      }));
  }

  /**
   * Near-duplicates that slipped past ingestion (two documents racing, or wording that drifted)
   * show up as two chunks shown side by side again and again. When they are also close in
   * meaning, the adjudicator decides; "same" merges the weaker into the stronger.
   */
  private async mergeCoSurfaced(collectionId: string): Promise<number> {
    const pairs: Array<{ a: string; b: string; n: string }> =
      await this.dataSource.query(
        `SELECT x.chunk_id AS a, y.chunk_id AS b, count(*) AS n
         FROM cl_usage_events x
         JOIN cl_usage_events y ON y.retrieval_id = x.retrieval_id AND x.chunk_id < y.chunk_id
         WHERE x.type = 'surfaced' AND y.type = 'surfaced'
           AND x.collection_id = $1 AND y.collection_id = $1
           AND x."createdAt" > now() - ($2 || ' days')::interval
         GROUP BY 1, 2 HAVING count(*) >= $3
         ORDER BY n DESC LIMIT 40`,
        [collectionId, String(CL_LOOP_WINDOW_DAYS), CL_MERGE_MIN_CO_SURFACED],
      );
    if (!pairs.length) return 0;
    const overruled = await this.actions.overruled(
      collectionId,
      ClLoopActionType.MERGE,
    );
    const profile = requireProfile(collectionId);
    let merged = 0;
    const gone = new Set<string>();
    for (const pair of pairs) {
      if (gone.has(pair.a) || gone.has(pair.b)) continue;
      if (overruled.has(pair.a) || overruled.has(pair.b)) continue;
      const both = await this.chunks.find({
        where: { id: In([pair.a, pair.b]), status: ClChunkStatus.ACTIVE },
      });
      if (
        both.length !== 2 ||
        both.some((c) => c.origin !== ClChunkOrigin.DISTILLED || c.pinned) ||
        // Merging across audiences would hide the absorbed idea from someone who could read it.
        !sameAudience(both[0], both[1])
      )
        continue;
      try {
        const embedded = await this.ai.contextEmbed(
          both.map((c) => c.statement),
        );
        const [va, vb] = embedded?.vectors ?? [];
        if (!va || !vb || cosine(va, vb) < CL_MERGE_SIMILARITY) continue;
        const [keep, absorb] = [...both].sort(
          (x, y) =>
            (y.effectiveness ?? 0.3) - (x.effectiveness ?? 0.3) ||
            y.sourceCount - x.sourceCount,
        );
        const { value } = await this.llm.adjudicate<{
          decision?: string;
          neighbourCode?: string | null;
        }>(
          JSON.stringify({
            noun: profile.noun,
            candidate: {
              statement: absorb.statement,
              situations: absorb.situations,
              attributes: absorb.attributes,
            },
            neighbours: [
              {
                code: keep.code,
                statement: keep.statement,
                situations: keep.situations,
              },
            ],
          }),
        );
        if (value?.decision !== 'same') continue;
        const before = {
          status: absorb.status,
          supersededById: absorb.supersededById ?? null,
          keepId: keep.id,
          keepSourceCount: keep.sourceCount,
        };
        await this.chunkService.snapshot(absorb, 'curator: merge', null);
        absorb.status = ClChunkStatus.SUPERSEDED;
        absorb.supersededById = keep.id;
        await this.chunkService.saveChanged(absorb, 'curator: merge', null);
        await this.chunks.update(
          { id: keep.id },
          { sourceCount: keep.sourceCount + absorb.sourceCount },
        );
        await this.actions.record({
          collectionId,
          loop: ClLoop.CURATOR,
          action: ClLoopActionType.MERGE,
          chunkId: absorb.id,
          reason: `Merged ${absorb.code} into ${keep.code}: the same idea, shown together ${pair.n} times`,
          before,
          after: { status: ClChunkStatus.SUPERSEDED, supersededBy: keep.code },
          evidence: { coSurfaced: Number(pair.n) },
        });
        gone.add(absorb.id);
        merged++;
      } catch (error) {
        this.logger.warn(
          `Merge check skipped for a pair in ${collectionId}: ${(error as Error).message}`,
        );
      }
    }
    return merged;
  }
}
