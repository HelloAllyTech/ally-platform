import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { AiService } from 'src/ai/service/ai.service';
import { LoggerService } from 'src/logger/logger.service';
import {
  CL_GAP_CLUSTER_SIMILARITY,
  CL_GAP_MIN_QUERIES,
  CL_GAP_WINDOW_DAYS,
} from '../constants/context-library.constants';
import { ClGapTopic } from '../entity/cl-loop.entity';
import { ClGapKind } from '../enum/context-library.enum';
import { greedyClusters } from '../util/loops.util';
import { ContextLlmService } from './context-llm.service';

const MAX_GAP_QUERIES = 400;
const MAX_TOPICS_PER_RUN = 25;
const EMBED_BATCH = 64;

interface GapQuery {
  text: string;
  sensitive: boolean;
  tenantId: string | null;
  at: Date;
}

/**
 * What's missing: searches whose best result was below "good" (or that found nothing),
 * clustered by meaning and named by a small model. A platform gap says "upload documents"; an
 * organisation's gap — searches from its own learners that its own entries didn't answer — says
 * "add entries", and is shown only to that organisation's admins.
 *
 * Sensitive queries (a person's own words) count towards a topic and help the model name it,
 * but their text is never stored here: the topic reaches the page as the model's general label.
 */
@Injectable()
export class ContextGapsService {
  private readonly logger = LoggerService.getInstance(ContextGapsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly ai: AiService,
    private readonly llm: ContextLlmService,
    @InjectRepository(ClGapTopic)
    private readonly topics: Repository<ClGapTopic>,
  ) {}

  async run(collectionId: string): Promise<number> {
    const rows: Array<{
      queries: string[];
      query_sensitive: boolean;
      audience: { tenantId?: string | null } | null;
      createdAt: Date;
    }> = await this.dataSource.query(
      `SELECT r.queries, r.query_sensitive, r.audience, r."createdAt"
       FROM cl_retrievals r
       WHERE $1 = ANY(r.collections_searched)
         AND r."createdAt" > now() - ($2 || ' days')::interval
         AND NOT r.failed AND NOT r.exclude_from_usage
         AND (r.top_band IS NULL OR r.top_band = 'low')
       ORDER BY r."createdAt" DESC
       LIMIT $3`,
      [collectionId, String(CL_GAP_WINDOW_DAYS), MAX_GAP_QUERIES],
    );
    const seen = new Set<string>();
    const queries: GapQuery[] = [];
    for (const r of rows) {
      for (const text of r.queries ?? []) {
        const key = `${r.audience?.tenantId ?? ''}|${text.trim().toLowerCase()}`;
        if (!text.trim() || seen.has(key)) continue;
        seen.add(key);
        queries.push({
          text: text.trim().slice(0, 300),
          sensitive: Boolean(r.query_sensitive),
          tenantId: r.audience?.tenantId ?? null,
          at: new Date(r.createdAt),
        });
      }
    }
    if (queries.length < CL_GAP_MIN_QUERIES) return 0;

    // Cluster within each audience: one organisation's gaps are never mixed with another's.
    const groups = new Map<string, GapQuery[]>();
    for (const q of queries) {
      const key = q.tenantId ?? '';
      groups.set(key, [...(groups.get(key) ?? []), q]);
    }

    const found: Array<Omit<ClGapTopic, 'id' | 'createdAt' | 'updatedAt'>> = [];
    for (const [tenantKey, group] of groups) {
      if (group.length < CL_GAP_MIN_QUERIES) continue;
      const vectors = await this.embed(group);
      if (vectors.length !== group.length) continue;
      const clusters = greedyClusters(vectors, CL_GAP_CLUSTER_SIMILARITY)
        .filter((c) => c.length >= CL_GAP_MIN_QUERIES)
        .sort((a, b) => b.length - a.length)
        .slice(0, MAX_TOPICS_PER_RUN);
      for (const cluster of clusters) {
        const members = cluster.map((i) => group[i]);
        const label = await this.label(members);
        if (!label) continue;
        found.push({
          collectionId,
          kind: tenantKey ? ClGapKind.ORGANISATION : ClGapKind.PLATFORM,
          tenantId: tenantKey || null,
          label,
          queryCount: members.length,
          exampleQueries: members
            .filter((m) => !m.sensitive)
            .slice(0, 5)
            .map((m) => m.text),
          firstSeenAt: new Date(Math.min(...members.map((m) => +m.at))),
          lastSeenAt: new Date(Math.max(...members.map((m) => +m.at))),
          status: 'open',
        } as any);
      }
    }

    // Reconcile with what is already listed: keep dismissals, refresh what's still missing,
    // and mark as answered whatever stopped appearing.
    const existing = await this.topics.find({ where: { collectionId } });
    const keyOf = (t: { label: string; tenantId?: string | null }) =>
      `${t.tenantId ?? ''}|${t.label.trim().toLowerCase()}`;
    const byKey = new Map(existing.map((t) => [keyOf(t), t]));
    const stillOpen = new Set<string>();
    for (const topic of found) {
      const match = byKey.get(keyOf(topic));
      if (match?.status === 'dismissed') continue;
      if (match) {
        match.queryCount = topic.queryCount;
        match.exampleQueries = topic.exampleQueries;
        match.lastSeenAt = topic.lastSeenAt;
        match.status = 'open';
        await this.topics.save(match);
        stillOpen.add(match.id);
      } else {
        const saved = await this.topics.save(this.topics.create(topic));
        stillOpen.add(saved.id);
      }
    }
    const answered = existing
      .filter((t) => t.status === 'open' && !stillOpen.has(t.id))
      .map((t) => t.id);
    if (answered.length)
      await this.topics.update({ id: In(answered) }, { status: 'answered' });
    return found.length;
  }

  private async embed(group: GapQuery[]): Promise<number[][]> {
    const out: number[][] = [];
    try {
      for (let i = 0; i < group.length; i += EMBED_BATCH) {
        const batch = group.slice(i, i + EMBED_BATCH);
        const res = await this.ai.contextEmbed(
          batch.map((q) => q.text),
          batch.some((q) => q.sensitive),
        );
        out.push(...(res?.vectors ?? []));
      }
    } catch (error) {
      this.logger.warn(`Gap clustering skipped: ${(error as Error).message}`);
      return [];
    }
    return out;
  }

  private async label(members: GapQuery[]): Promise<string | null> {
    try {
      const { value } = await this.llm.gapLabel<{ label?: string }>(
        JSON.stringify({ searches: members.slice(0, 12).map((m) => m.text) }),
      );
      const label = String(value?.label ?? '').trim();
      return label ? label.slice(0, 160) : null;
    } catch (error) {
      this.logger.warn(`Gap label failed: ${(error as Error).message}`);
      return null;
    }
  }

  async list(collectionId: string, tenantId?: string | null) {
    const where: any = { collectionId, status: 'open' };
    if (tenantId !== undefined) where.tenantId = tenantId;
    const rows = await this.topics.find({
      where,
      order: { queryCount: 'DESC' },
      take: 50,
    });
    return rows.map((t) => ({
      id: t.id,
      label: t.label,
      kind: t.kind,
      queryCount: t.queryCount,
      exampleQueries: t.exampleQueries,
      lastSeenAt: t.lastSeenAt,
      action:
        t.kind === ClGapKind.PLATFORM ? 'upload_documents' : 'add_entries',
    }));
  }

  async dismiss(id: string): Promise<void> {
    await this.topics.update({ id }, { status: 'dismissed' });
  }
}
