import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import { ClChunk } from '../entity/cl-chunk.entity';
import {
  ClChunkOrigin,
  ClChunkStatus,
  ClCollectionId,
  ClEmbeddingStatus,
  ClUsageType,
  ClUseCase,
} from '../enum/context-library.enum';
import { CollectionProfile, requireProfile } from '../profiles';
import { Band } from '../util/fusion.util';
import { normaliseLabels, splitAgentText } from '../util/agent-curator.util';
import { ContextChunkService, toView } from './context-chunk.service';
import { ContextRetrievalService } from './context-retrieval.service';

/** Where an agent-written chunk came from. Stored as provenance, merged when chunks agree. */
export interface AgentChunkEvidence {
  /** A Builder session. */
  sessionId?: string | null;
  /** A Bug Hunter run. */
  runId?: string | null;
  /** A Bug Hunter finding. */
  findingId?: string | null;
}

export interface WriteAgentChunkInput {
  collection: ClCollectionId;
  /** Which agent wrote it — must be one the profile's `agentCuration.agents` names. */
  agent: string;
  statement: string;
  body?: string | null;
  /** The profile's facets (category, tags…). Unknown keys and off-vocabulary values are dropped. */
  facets?: Record<string, string | string[] | null | undefined>;
  /** Repos it applies to; empty or absent means platform-wide. */
  repos?: string[] | null;
  evidence?: AgentChunkEvidence | null;
  /** A person whose action produced it (an admin removing a wrong feature card). */
  createdBy?: number | null;
}

export interface AgentChunkHit {
  chunk: ClChunk;
  band: Band;
  card: string;
}

/** Attribute names each kind of evidence is kept under (always a list: agreements merge). */
const EVIDENCE_ATTRIBUTE: Record<keyof AgentChunkEvidence, string> = {
  sessionId: 'sessionIds',
  runId: 'runIds',
  findingId: 'findingIds',
};

/** The active chunks of one collection in scope for some repos, strongest evidence first. */
const EVIDENCE_ORDER =
  'c.source_count + c.times_applied - 2 * c.times_contradicted';

/**
 * Lessons and notes agents write into the Context Library (PLAN §6.3), and how agents read and
 * report on them.
 *
 * - **Write:** `writeAgentChunk` lands every chunk as a `candidate`. Candidates are never indexed
 *   or retrieved; the hourly agent curator (`ContextAgentCuratorService`) folds them into the
 *   active set. The text is the agent's and is stored as written (clipped into a statement plus
 *   the full body only when it runs past the profile's limit, so a lesson is never lost);
 *   enrichment adds retrieval metadata alongside, best-effort.
 * - **Read:** `search` runs the normal retrieval pipeline for a use case, scoped to the repos in
 *   play; `listActive` is the evidence-ranked list for always-on prompt blocks.
 * - **Report:** `recordFeedback` turns an agent's "these changed what I did / these turned out
 *   wrong" into `agent_applied` / `agent_contradicted` usage events, and marks the rest of what
 *   the run was shown `unused` — the evidence the curator's usage-based retirement reads.
 */
@Injectable()
export class ContextAgentChunkService {
  private readonly logger = LoggerService.getInstance(
    ContextAgentChunkService.name,
  );

  constructor(
    private readonly chunkService: ContextChunkService,
    private readonly retrieval: ContextRetrievalService,
    @InjectRepository(ClChunk) private readonly chunks: Repository<ClChunk>,
  ) {}

  private profileFor(collection: string): CollectionProfile {
    const profile = requireProfile(collection);
    if (
      !profile.agentCuration ||
      !profile.allowedOrigins.includes(ClChunkOrigin.AGENT)
    ) {
      throw new BadRequestException(
        `${profile.name} does not take agent-written ${profile.nounPlural}.`,
      );
    }
    return profile;
  }

  async writeAgentChunk(input: WriteAgentChunkInput): Promise<ClChunk> {
    const profile = this.profileFor(input.collection);
    if (!profile.agentCuration!.agents.includes(input.agent)) {
      throw new BadRequestException(
        `${input.agent} does not write to ${profile.name}.`,
      );
    }
    const text = input.statement?.trim() ?? '';
    if (!text) {
      throw new BadRequestException(
        `A ${profile.noun} needs some text to be worth keeping.`,
      );
    }
    const split = splitAgentText(text, profile.statementMaxChars);
    const body = input.body?.trim() || split.body;

    const facets = this.cleanFacets(profile, input.facets ?? {});
    const repos = normaliseLabels(input.repos);
    if (profile.facets.repos) facets.repos = repos;

    const attributes: Record<string, unknown> = {};
    for (const [key, attribute] of Object.entries(EVIDENCE_ATTRIBUTE) as Array<
      [keyof AgentChunkEvidence, string]
    >) {
      const value = input.evidence?.[key];
      if (value && profile.attributes[attribute])
        attributes[attribute] = [value];
    }

    const enriched = await this.chunkService.enrich(profile, {
      statement: split.statement,
      body,
      situations: [],
      exampleQueries: [],
      keywords: [],
      topics: [],
      facets,
      attributes,
    });

    const chunk = await this.chunkService.create({
      collectionId: profile.id,
      origin: ClChunkOrigin.AGENT,
      statement: split.statement,
      body,
      situations: enriched.situations,
      exampleQueries: enriched.exampleQueries,
      keywords: enriched.keywords,
      // Enrichment may only fill facets the agent left empty, never override them.
      facets: { ...this.cleanFacets(profile, enriched.facets), ...facets },
      attributes,
      status: ClChunkStatus.CANDIDATE,
      agent: input.agent,
      createdBy: input.createdBy ?? null,
    });
    // A candidate is never indexed; skip the outbox's round trip. Promotion re-hashes (status is
    // part of the hash) and queues it then.
    await this.chunks.update(
      { id: chunk.id },
      { embeddingStatus: ClEmbeddingStatus.SKIPPED },
    );
    chunk.embeddingStatus = ClEmbeddingStatus.SKIPPED;
    return chunk;
  }

  /** Profile facets only; vocabulary facets keep only known values; free text normalised. */
  cleanFacets(
    profile: CollectionProfile,
    raw: Record<string, unknown>,
  ): Record<string, string | string[]> {
    const out: Record<string, string | string[]> = {};
    for (const [key, spec] of Object.entries(profile.facets)) {
      const value = raw?.[key];
      if (value === undefined || value === null) continue;
      let list = normaliseLabels(Array.isArray(value) ? value : [value]);
      if (spec.values) list = list.filter((v) => spec.values!.includes(v));
      if (!list.length) continue;
      out[key] = spec.multi ? list : list[0];
    }
    return out;
  }

  /**
   * The active chunks in scope for these repos (platform-wide ones always; repo-specific ones
   * only for a repo in play), pinned first, then by evidence. For prompt blocks that are always
   * on rather than searched.
   */
  listActive(args: {
    collection: ClCollectionId;
    repos?: string[] | null;
    limit: number;
    pinnedOnly?: boolean;
  }): Promise<ClChunk[]> {
    const repos = normaliseLabels(args.repos);
    const qb = this.chunks
      .createQueryBuilder('c')
      .where('c.collection_id = :collection', { collection: args.collection })
      .andWhere('c.status = :status', { status: ClChunkStatus.ACTIVE });
    if (args.pinnedOnly) qb.andWhere('c.pinned = true');
    const platformWide = `(NOT (c.facets ? 'repos') OR jsonb_typeof(c.facets->'repos') <> 'array' OR jsonb_array_length(c.facets->'repos') = 0)`;
    if (repos.length) {
      qb.andWhere(
        `(${platformWide} OR (jsonb_typeof(c.facets->'repos') = 'array' AND c.facets->'repos' ?| ARRAY[:...repos]::text[]))`,
        { repos },
      );
    } else {
      qb.andWhere(platformWide);
    }
    return qb
      .orderBy('c.pinned', 'DESC')
      .addOrderBy(EVIDENCE_ORDER, 'DESC')
      .addOrderBy('c."createdAt"', 'DESC')
      .take(Math.min(Math.max(args.limit, 1), 200))
      .getMany();
  }

  /** Chunks by code, following merges, active only. */
  async activeByCodes(codes: string[]): Promise<ClChunk[]> {
    const rows = await this.chunkService.resolveCodes(codes);
    const seen = new Set<string>();
    return rows.filter((c) => {
      if (c.status !== ClChunkStatus.ACTIVE || seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });
  }

  /** Render chunks with their profile's card, for a prompt block. */
  card(chunk: ClChunk, band?: string): string {
    return requireProfile(chunk.collectionId).card(toView(chunk), band);
  }

  /**
   * Search one agent collection for a use case through the shared pipeline, scoped to the repos
   * in play. Only good-or-better results: an agent note in front of a model is advice, and a weak
   * one is noise. Throws when retrieval fails, so callers can tell "nothing" from "unavailable".
   */
  async search(args: {
    useCase: ClUseCase;
    collection: ClCollectionId;
    queries: string[];
    repos?: string[] | null;
    limit: number;
    sessionId?: string | null;
    excludeCodes?: string[];
    queryOrigin?: string;
  }): Promise<AgentChunkHit[]> {
    const queries = args.queries.map((q) => q.trim()).filter(Boolean);
    if (!queries.length) return [];
    const response = await this.retrieval.search({
      useCase: args.useCase,
      collections: [args.collection],
      queries,
      limit: args.limit,
      sessionId: args.sessionId ?? null,
      excludeCodes: args.excludeCodes,
      queryOrigin: args.queryOrigin ?? 'agent_tool',
      facetScope: { key: 'repos', values: normaliseLabels(args.repos) },
    });
    if (response.noConfidentMatch) return [];
    return response.results.map((r) => ({
      chunk: r.chunk,
      band: r.band,
      card: r.card,
    }));
  }

  /** Record that these chunks were put in front of an agent outside a search (an always-on list). */
  async recordShown(
    useCase: ClUseCase,
    chunkIds: string[],
    sessionId: string | null,
  ): Promise<void> {
    if (!chunkIds.length) return;
    await this.retrieval.recordUsage(
      useCase,
      { ids: chunkIds },
      ClUsageType.SURFACED,
      { sessionId, detail: { via: 'always_on' } },
    );
  }

  /**
   * An agent's verdict on what it was shown: `applied` changed what it did, `contradicted`
   * turned out wrong. Accepts ids or codes, and only ever touches chunks of this collection —
   * an id from another collection is ignored rather than trusted. With a session, everything
   * else the session was shown from this collection is recorded `unused`: only runs that
   * reported count towards "never applied", so an empty report is a real answer. A caller that
   * only knows about contradictions (it never saw what was applied) passes `markUnused: false`.
   */
  async recordFeedback(args: {
    useCase: ClUseCase;
    collection: ClCollectionId;
    sessionId?: string | null;
    applied: string[];
    contradicted?: string[];
    markUnused?: boolean;
  }): Promise<{ applied: number; contradicted: number; unused: number }> {
    const resolve = async (refs: string[]) => {
      const clean = [...new Set(refs.map((r) => String(r).trim()))].filter(
        Boolean,
      );
      if (!clean.length) return [] as ClChunk[];
      const uuids = clean.filter((r) => /^[0-9a-f-]{36}$/i.test(r));
      const codes = clean.filter((r) => !uuids.includes(r));
      const where = [
        ...(uuids.length
          ? [{ id: In(uuids), collectionId: args.collection }]
          : []),
        ...(codes.length
          ? [{ code: In(codes), collectionId: args.collection }]
          : []),
      ];
      return where.length ? this.chunks.find({ where }) : [];
    };
    const applied = await resolve(args.applied ?? []);
    const appliedIds = new Set(applied.map((c) => c.id));
    const contradicted = (await resolve(args.contradicted ?? [])).filter(
      (c) => !appliedIds.has(c.id),
    );
    const context = { sessionId: args.sessionId ?? null };

    if (applied.length) {
      await this.retrieval.recordUsage(
        args.useCase,
        { ids: applied.map((c) => c.id) },
        ClUsageType.AGENT_APPLIED,
        context,
      );
      await this.chunks
        .createQueryBuilder()
        .update()
        .set({
          timesApplied: () => '"times_applied" + 1',
          lastAppliedAt: new Date(),
        })
        .whereInIds(applied.map((c) => c.id))
        .execute();
    }
    if (contradicted.length) {
      await this.retrieval.recordUsage(
        args.useCase,
        { ids: contradicted.map((c) => c.id) },
        ClUsageType.AGENT_CONTRADICTED,
        context,
      );
      await this.chunks
        .createQueryBuilder()
        .update()
        .set({ timesContradicted: () => '"times_contradicted" + 1' })
        .whereInIds(contradicted.map((c) => c.id))
        .execute();
    }

    let unused = 0;
    if (args.sessionId && args.markUnused !== false) {
      try {
        const rows: Array<{ chunk_id: string }> = await this.chunks.query(
          `SELECT DISTINCT u.chunk_id
             FROM cl_usage_events u
            WHERE u.session_id = $1 AND u.collection_id = $2 AND u.type = 'surfaced'
              AND NOT (u.chunk_id = ANY($3::uuid[]))
              AND NOT EXISTS (
                SELECT 1 FROM cl_usage_events x
                 WHERE x.session_id = $1 AND x.chunk_id = u.chunk_id
                   AND x.type IN ('unused', 'agent_applied', 'agent_contradicted'))`,
          [
            args.sessionId,
            args.collection,
            [...applied, ...contradicted].map((c) => c.id),
          ],
        );
        if (rows.length) {
          await this.retrieval.recordUsage(
            args.useCase,
            { ids: rows.map((r) => r.chunk_id) },
            ClUsageType.UNUSED,
            context,
          );
          unused = rows.length;
        }
      } catch (error) {
        this.logger.warn(
          `Could not mark unused ${args.collection} chunks: ${(error as Error).message}`,
        );
      }
    }
    return {
      applied: applied.length,
      contradicted: contradicted.length,
      unused,
    };
  }
}
