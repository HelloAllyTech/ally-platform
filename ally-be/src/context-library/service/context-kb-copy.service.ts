import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { isUUID } from 'class-validator';
import { DataSource, Repository } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import { ClChunk, ClExampleQuery } from '../entity/cl-chunk.entity';
import { ClChunkOrigin, ClUseCase } from '../enum/context-library.enum';
import { requireProfile } from '../profiles';
import { ClActor, ContextChunkService } from './context-chunk.service';
import { ContextGapsService } from './context-gaps.service';
import {
  ContextKbImportService,
  KbCorpusMigration,
} from './context-kb-import.service';
import { ContextRetrievalService } from './context-retrieval.service';

/** The window of logged searches the smoke check replays (PLAN.md §6.5). */
export const SMOKE_CHECK_WINDOW_DAYS = 30;
/** A cost bound, not a quality one: each replay runs the graded re-rank. Newest first. */
export const SMOKE_CHECK_MAX_QUERIES = 300;
const SMOKE_CHECK_CONCURRENCY = 4;
const ENRICH_CONCURRENCY = 5;
const ENRICH_BATCH = 50;

/**
 * Where each old consumer kept the asker. `kb_retrievals` never recorded an organisation, so a
 * replay finds it through the session the search served: a guide thread, or a roleplay session.
 */
const SESSION_TENANT: Partial<Record<ClUseCase, string>> = {
  [ClUseCase.ALLY_GUIDE]: `(SELECT t.tenant_id FROM guide_threads t WHERE t.id::text = r.session_id::text)`,
  [ClUseCase.DEBRIEF]: `(SELECT s.tenant_id FROM scenario_sessions s WHERE s.id::text = r.session_id::text)`,
};

export interface SmokeCheckReport {
  corpus: string;
  collectionId: string;
  useCase: ClUseCase;
  windowDays: number;
  /** Searches logged in the window, old corpus and new collection together. */
  logged: number;
  /** Distinct (organisation, query) pairs replayed. */
  replayed: number;
  /** True when there were more than `SMOKE_CHECK_MAX_QUERIES` and the oldest were left out. */
  capped: boolean;
  /** At least one good-or-better result. */
  answered: number;
  /** No good result, but grouped into a named missing topic below. */
  inGaps: number;
  /** No good result, and too many topics to name them all. */
  unlabelled: number;
  /** The replay itself failed — says nothing about what the collection holds. */
  failed: number;
  /** Missing topics, as model-written labels with counts. Never a learner's words. */
  gaps: Array<{ label: string; queries: number }>;
  /** Every replayed search either answered or appears in a named gap, and none failed. */
  passed: boolean;
}

/**
 * What follows a word-for-word copy of a Knowledge Base corpus (phase 6): enrichment of the
 * imported passages, and the smoke check before the old corpus is retired (PLAN.md §6.5).
 *
 * Both are platform-admin actions on platform-wide content, so both are refused to an admin
 * restricted to some organisations.
 */
@Injectable()
export class ContextKbCopyService {
  private readonly logger = LoggerService.getInstance(
    ContextKbCopyService.name,
  );
  private readonly enriching = new Set<string>();

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(ClChunk) private readonly chunks: Repository<ClChunk>,
    private readonly chunkService: ContextChunkService,
    private readonly kbImport: ContextKbImportService,
    private readonly retrieval: ContextRetrievalService,
    private readonly gaps: ContextGapsService,
  ) {}

  private assertCopied(migration: KbCorpusMigration): ClUseCase {
    if (migration.mode !== 'copy' || !migration.useCase) {
      throw new BadRequestException(
        `${migration.corpus} was not copied word for word.`,
      );
    }
    return migration.useCase;
  }

  // ── Enrichment ─────────────────────────────────────────────────────────────

  /**
   * Start enriching every imported chunk still marked pending, in the background. Retrieval
   * metadata only — situations, example searches, keywords, missing facets — and a one-line
   * statement in place of the citation heading the copy wrote. The body is never touched.
   */
  async startEnrichment(
    migration: KbCorpusMigration,
    actor: ClActor,
  ): Promise<{ started: boolean; pending: number }> {
    await this.kbImport.assertPlatformAdmin(actor);
    this.assertCopied(migration);
    const pending = await this.pendingCount(migration.collectionId);
    if (!pending || this.enriching.has(migration.collectionId)) {
      return { started: false, pending };
    }
    this.enriching.add(migration.collectionId);
    void this.enrichAll(migration.collectionId, actor.userId)
      .catch((error) =>
        this.logger.warn(
          `Enriching ${migration.collectionId} stopped: ${(error as Error).message}`,
        ),
      )
      .finally(() => this.enriching.delete(migration.collectionId));
    return { started: true, pending };
  }

  private async pendingCount(collectionId: string): Promise<number> {
    const [row]: Array<{ n: string }> = await this.dataSource.query(
      `SELECT COUNT(*) AS n FROM cl_chunks
        WHERE collection_id = $1 AND origin = 'imported'
          AND quality->>'enrichment' = 'pending'`,
      [collectionId],
    );
    return Number(row?.n ?? 0);
  }

  /** Every pending chunk, a batch at a time; stops when a whole batch made no progress. */
  async enrichAll(
    collectionId: string,
    userId: number | null,
  ): Promise<{ enriched: number; failed: number }> {
    const totals = { enriched: 0, failed: 0 };
    const skip = new Set<string>();
    for (;;) {
      const batch = (
        await this.chunks
          .createQueryBuilder('c')
          .where('c.collection_id = :id', { id: collectionId })
          .andWhere('c.origin = :origin', { origin: ClChunkOrigin.IMPORTED })
          .andWhere(`c.quality->>'enrichment' = 'pending'`)
          .orderBy('c.createdAt', 'ASC')
          .take(ENRICH_BATCH + skip.size)
          .getMany()
      ).filter((c) => !skip.has(c.id));
      if (!batch.length) break;
      let progress = 0;
      for (let i = 0; i < batch.length; i += ENRICH_CONCURRENCY) {
        const results = await Promise.all(
          batch
            .slice(i, i + ENRICH_CONCURRENCY)
            .map((chunk) => this.enrichOne(chunk, userId)),
        );
        results.forEach((ok, j) => {
          if (ok) {
            progress++;
            totals.enriched++;
          } else {
            totals.failed++;
            skip.add(batch[i + j].id);
          }
        });
      }
      if (!progress) break;
    }
    this.logger.info(
      `Enriched ${totals.enriched} imported chunk(s) in ${collectionId}; ${totals.failed} left for a retry`,
    );
    return totals;
  }

  /**
   * One imported chunk. True when enrichment produced something; false leaves it pending for the
   * next run. `ContextChunkService.enrich` keeps whatever is already set, so the copy's facets
   * (owner-derived kind, tags as topics) stand.
   */
  async enrichOne(chunk: ClChunk, userId: number | null): Promise<boolean> {
    const profile = requireProfile(chunk.collectionId);
    const fromCitation = chunk.quality?.statementFrom === 'citation';
    const enriched = await this.chunkService.enrich(profile, {
      // An empty statement asks for a one-line summary of the body; an admin-edited one stays.
      statement: fromCitation ? '' : chunk.statement,
      body: chunk.body ?? null,
      situations: chunk.situations ?? [],
      exampleQueries: (chunk.exampleQueries ?? []).map((q) => q.text),
      keywords: chunk.keywords ?? [],
      topics: chunk.topics ?? [],
      facets: chunk.facets ?? {},
      attributes: chunk.attributes ?? {},
    });
    const gained =
      enriched.situations.length > (chunk.situations ?? []).length ||
      enriched.exampleQueries.length > (chunk.exampleQueries ?? []).length;
    if (!gained) return false;
    await this.chunkService.snapshot(chunk, 'enrich', userId);
    if (fromCitation && enriched.statement.trim()) {
      chunk.statement = enriched.statement.trim();
    }
    chunk.situations = enriched.situations;
    chunk.exampleQueries = enriched.exampleQueries as ClExampleQuery[];
    chunk.keywords = enriched.keywords;
    chunk.facets = { ...enriched.facets, ...(chunk.facets ?? {}) };
    chunk.quality = {
      ...(chunk.quality ?? {}),
      enrichment: 'done',
      ...(fromCitation && enriched.statement.trim()
        ? { statementFrom: 'enrichment' }
        : {}),
    };
    await this.chunkService.saveChanged(chunk, 'enrich', userId);
    return true;
  }

  // ── Smoke check ────────────────────────────────────────────────────────────

  /**
   * Replay every search logged for the use case in the last 30 days — on the old corpus
   * (`kb_retrievals`) and on the new collection (`cl_retrievals`) — against the new collection,
   * as the original asker's organisation, and report how many found at least one good-or-better
   * result. The misses are grouped into missing topics, named by a model.
   *
   * Read-only: replays write no retrieval log, usage or cache, and nothing is stored. The report
   * holds counts and topic labels only; these searches are a learner's own words, so their text
   * never leaves this method (nor reaches a log).
   */
  async smokeCheck(
    migration: KbCorpusMigration,
    actor: ClActor,
  ): Promise<SmokeCheckReport> {
    await this.kbImport.assertPlatformAdmin(actor);
    const useCase = this.assertCopied(migration);
    const window = String(SMOKE_CHECK_WINDOW_DAYS);

    const old: Array<{ query: string; tenant_id: string | null }> =
      await this.dataSource.query(
        `SELECT r.query, ${SESSION_TENANT[useCase] ?? 'NULL'} AS tenant_id
           FROM kb_retrievals r
          WHERE r.consumer = $1 AND r."createdAt" > now() - ($2 || ' days')::interval
          ORDER BY r."createdAt" DESC`,
        [useCase, window],
      );
    const current: Array<{
      queries: string[];
      audience: { tenantId?: string | null } | null;
    }> = await this.dataSource.query(
      `SELECT r.queries, r.audience
         FROM cl_retrievals r
        WHERE r.use_case = $1 AND NOT r.failed AND NOT r.exclude_from_usage
          AND r."createdAt" > now() - ($2 || ' days')::interval
        ORDER BY r."createdAt" DESC`,
      [useCase, window],
    );

    const logged = old.length + current.length;
    const seen = new Set<string>();
    const pairs: Array<{ query: string; tenantId: string | null }> = [];
    const add = (query: string, tenant: string | null | undefined) => {
      const text = (query ?? '').trim();
      if (!text) return;
      const tenantId = tenant && isUUID(tenant) ? tenant : null;
      const key = `${tenantId ?? ''}|${text.toLowerCase()}`;
      if (seen.has(key)) return;
      seen.add(key);
      pairs.push({ query: text.slice(0, 500), tenantId });
    };
    for (const row of current) {
      for (const q of row.queries ?? []) add(q, row.audience?.tenantId);
    }
    for (const row of old) add(row.query, row.tenant_id);
    const capped = pairs.length > SMOKE_CHECK_MAX_QUERIES;
    const replays = pairs.slice(0, SMOKE_CHECK_MAX_QUERIES);

    let answered = 0;
    let failed = 0;
    const misses: string[] = [];
    for (let i = 0; i < replays.length; i += SMOKE_CHECK_CONCURRENCY) {
      await Promise.all(
        replays.slice(i, i + SMOKE_CHECK_CONCURRENCY).map(async (pair) => {
          try {
            const response = await this.retrieval.search(
              {
                useCase,
                audience: { tenantId: pair.tenantId },
                collections: [migration.collectionId],
                queries: [pair.query],
              },
              { replay: true },
            );
            if (
              response.results.some(
                (r) => r.band === 'good' || r.band === 'strong',
              )
            ) {
              answered++;
            } else {
              misses.push(pair.query);
            }
          } catch {
            failed++;
          }
        }),
      );
    }

    const { topics, unlabelled } = misses.length
      ? await this.gaps.topicsFor(misses, true)
      : { topics: [], unlabelled: 0 };
    const inGaps = topics.reduce((n, t) => n + t.queries, 0);
    const report: SmokeCheckReport = {
      corpus: migration.corpus,
      collectionId: migration.collectionId,
      useCase,
      windowDays: SMOKE_CHECK_WINDOW_DAYS,
      logged,
      replayed: replays.length,
      capped,
      answered,
      inGaps,
      unlabelled,
      failed,
      gaps: topics,
      passed: failed === 0 && answered + inGaps === replays.length,
    };
    this.logger.info(
      `Smoke check ${migration.corpus} → ${migration.collectionId}: ${answered}/${replays.length} answered, ` +
        `${inGaps} in ${topics.length} gap topic(s), ${unlabelled} unlabelled, ${failed} failed`,
    );
    return report;
  }
}
