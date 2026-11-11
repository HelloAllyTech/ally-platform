import {
  Injectable,
  OnApplicationBootstrap,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Like, Repository } from 'typeorm';
import { Case } from 'src/case/entity/case.entity';
import { CaseStatus } from 'src/case/type/cases.type';
import { Competency } from 'src/learn/entity/competency.entity';
import { Scenarios } from 'src/learn/entity/scenarios.entity';
import { ScenarioStatus } from 'src/learn/type/scenario.type';
import { LoggerService } from 'src/logger/logger.service';
import { RedisService } from 'src/redis/service/redis.service';
import { scheduledTaskRegistry } from 'src/scheduler/registry/scheduled-task.registry';
import { ScenarioCharacter } from 'src/scenario-character/entity/scenario-character.entity';
import { TrackComponentTemplate } from 'src/track/entity/track-component-template.entity';
import {
  CL_CATALOGUE_BOOT_DELAY_MS,
  CL_CATALOGUE_DEBOUNCE_MS,
  CL_CATALOGUE_ENRICH_CONCURRENCY,
  CL_CATALOGUE_ENRICH_PER_RUN,
  CL_CATALOGUE_LOCK_TTL_SECONDS,
} from '../constants/context-library.constants';
import { ClChunk } from '../entity/cl-chunk.entity';
import {
  ClChunkOrigin,
  ClChunkStatus,
  ClCollectionId,
} from '../enum/context-library.enum';
import { normaliseTag, requireProfile } from '../profiles';
import {
  CATALOGUE_ITEM_KINDS,
  CATALOGUE_STATEMENT_MAX_CHARS,
  CATALOGUE_TABLES,
  CatalogueItemKind,
  catalogueSyncKey,
} from '../profiles/content-catalogue.profile';
import { ContextChunkService } from './context-chunk.service';

export const CL_CATALOGUE_RECONCILE_TASK = 'context-library-catalogue';
const LOCK_KEY = 'cl:catalogue:reconcile';

/** One Studio row as the catalogue mirrors it. Built from the row, never from the chunk. */
export interface CatalogueItem {
  kind: CatalogueItemKind;
  id: string;
  title: string;
  summary: string | null;
  competencyIds: string[];
  competencies: string[];
  difficulty: string | null;
  languages: string[];
  detail: string | null;
  /** The organisation that owns the row; null when Ally owns it (global). */
  ownerTenantId: string | null;
}

/** The fields of a synced chunk its source row decides. Everything else (searches) is the chunk's. */
export interface CatalogueChunkFields {
  statement: string;
  facets: Record<string, string | string[]>;
  attributes: Record<string, unknown>;
  topics: string[];
  isGlobal: boolean;
  tenantIds: string[];
}

export interface CatalogueReconcileReport {
  kind: CatalogueItemKind;
  active: number;
  created: number;
  updated: number;
  archived: number;
  restored: number;
}

/** Plain text, one line, at most `max` characters: Studio descriptions can hold HTML. */
export function oneLine(value: unknown, max = 160): string | null {
  if (typeof value !== 'string') return null;
  const flat = value
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!flat) return null;
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

const TEMPLATE_TYPE_LABELS: Record<string, string> = {
  QUIZ: 'Quiz',
  ARTICLE: 'Article',
  VIDEO: 'Video',
  JOURNAL: 'Journal',
  ANNOTATED_ARTIFACT: 'Annotated example',
};

/** What a synced chunk should say, from its item. Pure, so the sync is tested without a database. */
export function catalogueChunkFields(
  item: CatalogueItem,
): CatalogueChunkFields {
  const statement = (
    item.summary ? `${item.title} — ${item.summary}` : item.title
  )
    .slice(0, CATALOGUE_STATEMENT_MAX_CHARS)
    .trim();
  const facets: Record<string, string | string[]> = { itemKind: item.kind };
  if (item.competencies.length) facets.competencies = item.competencies;
  if (item.difficulty) facets.difficulty = item.difficulty;
  if (item.languages.length) facets.languages = item.languages;
  const attributes: Record<string, unknown> = { title: item.title };
  if (item.summary) attributes.summary = item.summary;
  if (item.competencyIds.length) attributes.competencyIds = item.competencyIds;
  if (item.detail) attributes.detail = item.detail;
  return {
    statement,
    facets,
    attributes,
    topics: item.competencies.map(normaliseTag).filter(Boolean),
    isGlobal: !item.ownerTenantId,
    tenantIds: item.ownerTenantId ? [item.ownerTenantId] : [],
  };
}

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** True when the chunk already says what its item says. */
export function chunkMatches(
  chunk: Pick<
    ClChunk,
    'statement' | 'facets' | 'attributes' | 'topics' | 'isGlobal' | 'tenantIds'
  >,
  fields: CatalogueChunkFields,
): boolean {
  return (
    chunk.statement === fields.statement &&
    same(chunk.facets, fields.facets) &&
    same(chunk.attributes, fields.attributes) &&
    same(chunk.topics, fields.topics) &&
    chunk.isGlobal === fields.isGlobal &&
    same([...(chunk.tenantIds ?? [])].sort(), [...fields.tenantIds].sort())
  );
}

/**
 * Keeps the Content Catalogue in step with Studio (PLAN.md §6.4): one `synced` chunk per active
 * roleplay, case, character and component template, keyed `sync_key = <table>:<row id>`.
 *
 * Three ways a change arrives:
 *  - **As it is written.** `ContextCatalogueSubscriber` hears every insert, update, delete,
 *    soft delete and restore on the four tables and queues the row (or, for a bulk write that
 *    names no row, the whole kind). The queue flushes after a short pause, so a save and the
 *    writes around it in the same request land as one sync, after they commit.
 *  - **Nightly**, a reconciliation diffs every kind against its table in both directions, which
 *    heals anything a raw SQL write slipped past the subscriber.
 *  - **First boot.** The reconciliation's first run is the backfill: shortly after start-up, if
 *    the collection holds no synced item yet, it runs once. A platform admin can also run it.
 *
 * The source table owns the text. A sync rewrites `statement`, facets, `attributes`, `topics`
 * and the audience from the row and nothing else: learned and enriched example searches stay. An
 * item that stops being active is archived; one that comes back is restored with its history.
 * Enrichment adds example searches and situations beside the text, never instead of it.
 */
@Injectable()
export class ContextCatalogueSyncService
  implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = LoggerService.getInstance(
    ContextCatalogueSyncService.name,
  );
  private readonly pendingItems = new Map<string, CatalogueItemKind>();
  private readonly pendingKinds = new Set<CatalogueItemKind>();
  private flushTimer: NodeJS.Timeout | null = null;
  private bootTimer: NodeJS.Timeout | null = null;
  private flushing: Promise<void> | null = null;
  private enriching = false;
  private stopped = false;

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(ClChunk) private readonly chunks: Repository<ClChunk>,
    private readonly chunkService: ContextChunkService,
    private readonly redis: RedisService,
  ) {}

  onModuleInit(): void {
    scheduledTaskRegistry.register('daily', CL_CATALOGUE_RECONCILE_TASK, () =>
      this.reconcile({ enrich: true }).then(() => undefined),
    );
  }

  onApplicationBootstrap(): void {
    this.bootTimer = setTimeout(() => {
      this.bootTimer = null;
      void this.backfillIfEmpty().catch((error) =>
        this.logger.warn(
          `Content Catalogue backfill did not run: ${(error as Error).message}`,
        ),
      );
    }, CL_CATALOGUE_BOOT_DELAY_MS);
    this.bootTimer.unref?.();
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    if (this.bootTimer) clearTimeout(this.bootTimer);
  }

  // ── The queue the subscriber feeds ────────────────────────────────────────

  /** One row changed. */
  queueItem(kind: CatalogueItemKind, id: string | number): void {
    this.pendingItems.set(catalogueSyncKey(kind, id), kind);
    this.schedule();
  }

  /** Rows of this kind changed, but the write did not say which (a bulk update or delete). */
  queueKind(kind: CatalogueItemKind): void {
    this.pendingKinds.add(kind);
    this.schedule();
  }

  private schedule(): void {
    if (this.stopped || this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, CL_CATALOGUE_DEBOUNCE_MS);
    this.flushTimer.unref?.();
  }

  /** Sync everything queued. Never throws: the nightly run heals whatever failed here. */
  async flush(): Promise<void> {
    if (this.flushing) {
      await this.flushing;
      if (this.pendingItems.size || this.pendingKinds.size) this.schedule();
      return;
    }
    const kinds = [...this.pendingKinds];
    const items = [...this.pendingItems.entries()].filter(
      ([, kind]) => !this.pendingKinds.has(kind),
    );
    this.pendingKinds.clear();
    this.pendingItems.clear();
    this.flushing = (async () => {
      for (const kind of kinds) {
        await this.reconcileKind(kind).catch((error) =>
          this.logger.warn(
            `Content Catalogue sync of ${kind} failed: ${(error as Error).message}`,
          ),
        );
      }
      for (const [key, kind] of items) {
        await this.syncItem(kind, key.slice(key.indexOf(':') + 1)).catch(
          (error) =>
            this.logger.warn(
              `Content Catalogue sync of ${key} failed: ${(error as Error).message}`,
            ),
        );
      }
      if (kinds.length || items.length) void this.enrichPending(items.length);
    })();
    try {
      await this.flushing;
    } finally {
      this.flushing = null;
    }
  }

  // ── Reading Studio ────────────────────────────────────────────────────────

  private async competencyNames(ids: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter(Boolean))];
    if (!unique.length) return new Map();
    const rows = await this.dataSource.getRepository(Competency).find({
      where: { id: In(unique) },
      select: { id: true, name: true },
    });
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  /**
   * The ACTIVE rows of one kind, as catalogue items — every one, or only `ids`. Roleplays and
   * cases are active when published and not deleted; characters and templates have no status
   * (a deleted one is gone), so every row counts.
   */
  async loadActive(
    kind: CatalogueItemKind,
    ids?: string[],
  ): Promise<CatalogueItem[]> {
    const only = ids?.length ? ids : null;
    switch (kind) {
      case 'roleplay': {
        const numeric = only
          ?.map(Number)
          .filter((n) => Number.isInteger(n) && n > 0);
        if (only && !numeric?.length) return [];
        const rows = await this.dataSource.getRepository(Scenarios).find({
          where: {
            status: ScenarioStatus.ACTIVE,
            deletedAt: IsNull(),
            ...(numeric ? { id: In(numeric) } : {}),
          },
        });
        const names = await this.competencyNames(
          rows.flatMap((r) => [
            ...(r.competencyId ? [r.competencyId] : []),
            ...(r.competencyIds ?? []),
          ]),
        );
        return rows.map((r) => {
          const competencyIds = [
            ...new Set([
              ...(r.competencyId ? [r.competencyId] : []),
              ...(r.competencyIds ?? []),
            ]),
          ];
          return {
            kind,
            id: String(r.id),
            title: oneLine(r.title, 200) ?? `Roleplay ${r.id}`,
            summary: oneLine(r.description),
            competencyIds,
            competencies: competencyIds
              .map((id) => names.get(id))
              .filter((n): n is string => Boolean(n)),
            difficulty: r.difficultyLevel ?? null,
            languages: Object.keys(r.metadata?.languageVoices ?? {}),
            detail: null,
            ownerTenantId: null,
          };
        });
      }
      case 'case': {
        const rows = await this.dataSource.getRepository(Case).find({
          where: {
            status: CaseStatus.ACTIVE,
            deletedAt: IsNull(),
            ...(only ? { id: In(only) } : {}),
          },
        });
        return rows.map((r) => ({
          kind,
          id: r.id,
          title: oneLine(r.title, 200) ?? 'Untitled case',
          summary: oneLine(r.description),
          competencyIds: [],
          competencies: [],
          difficulty: null,
          languages: [],
          detail: null,
          ownerTenantId: null,
        }));
      }
      case 'character': {
        const rows = await this.dataSource
          .getRepository(ScenarioCharacter)
          .find({ where: only ? { id: In(only) } : {} });
        return rows.map((r) => ({
          kind,
          id: r.id,
          title: oneLine(r.name, 200) ?? 'Unnamed character',
          summary: oneLine(
            [r.age ? String(r.age) : null, r.gender, r.profession]
              .filter(Boolean)
              .join(', '),
          ),
          competencyIds: [],
          competencies: [],
          difficulty: null,
          languages: [],
          detail: oneLine(r.currentLocation),
          // A character an organisation made is theirs alone; an Ally character is global.
          ownerTenantId: r.tenantId ?? null,
        }));
      }
      case 'template': {
        const rows = await this.dataSource
          .getRepository(TrackComponentTemplate)
          .find({ where: only ? { id: In(only) } : {} });
        return rows.map((r) => {
          const type = TEMPLATE_TYPE_LABELS[r.type] ?? String(r.type);
          return {
            kind,
            id: r.id,
            title: oneLine(r.title, 200) ?? 'Untitled template',
            summary: `${type} template`,
            competencyIds: [],
            competencies: [],
            difficulty: null,
            languages: [],
            detail: String(r.type),
            ownerTenantId: null,
          };
        });
      }
      default:
        return [];
    }
  }

  // ── Writing chunks ────────────────────────────────────────────────────────

  /** Bring one item's chunk in step with its row: create, update, archive or restore. */
  async syncItem(kind: CatalogueItemKind, id: string): Promise<void> {
    const syncKey = catalogueSyncKey(kind, id);
    const [item] = await this.loadActive(kind, [id]);
    const chunk = await this.chunks.findOne({ where: { syncKey } });
    await this.apply(syncKey, item ?? null, chunk);
  }

  /** What changed for one item, applied. Returns which way it went, for the report. */
  private async apply(
    syncKey: string,
    item: CatalogueItem | null,
    chunk: ClChunk | null,
  ): Promise<'created' | 'updated' | 'archived' | 'restored' | null> {
    if (!item) {
      if (!chunk || chunk.status !== ClChunkStatus.ACTIVE) return null;
      await this.chunkService.snapshot(chunk, 'synced: no longer active', null);
      chunk.status = ClChunkStatus.ARCHIVED;
      await this.chunkService.saveChanged(chunk, 'synced', null);
      return 'archived';
    }
    const fields = catalogueChunkFields(item);
    if (!chunk) {
      try {
        await this.chunkService.create({
          collectionId: ClCollectionId.CONTENT_CATALOGUE,
          origin: ClChunkOrigin.SYNCED,
          syncKey,
          statement: fields.statement,
          facets: fields.facets,
          attributes: fields.attributes,
          topics: fields.topics,
          isGlobal: fields.isGlobal,
          tenantIds: fields.tenantIds,
          ownerTenantId: null,
          quality: { enrichment: 'pending' },
        });
        return 'created';
      } catch (error) {
        // Another pod synced it first (the sync key is unique): carry on as an update.
        const existing = await this.chunks.findOne({ where: { syncKey } });
        if (!existing) throw error;
        chunk = existing;
      }
    }
    const restoring = chunk.status !== ClChunkStatus.ACTIVE;
    if (!restoring && chunkMatches(chunk, fields)) return null;
    await this.chunkService.snapshot(
      chunk,
      restoring ? 'synced: active again' : 'synced',
      null,
    );
    const retitled = chunk.statement !== fields.statement;
    chunk.statement = fields.statement;
    chunk.facets = fields.facets;
    chunk.attributes = fields.attributes;
    chunk.topics = fields.topics;
    chunk.isGlobal = fields.isGlobal;
    chunk.tenantIds = fields.tenantIds;
    chunk.ownerTenantId = null;
    chunk.status = ClChunkStatus.ACTIVE;
    if (retitled && !(chunk.exampleQueries ?? []).length) {
      chunk.quality = { ...(chunk.quality ?? {}), enrichment: 'pending' };
    }
    await this.chunkService.saveChanged(chunk, 'synced', null);
    return restoring ? 'restored' : 'updated';
  }

  /** One kind, both directions: every active row has an active chunk, and nothing else does. */
  async reconcileKind(
    kind: CatalogueItemKind,
  ): Promise<CatalogueReconcileReport> {
    const report: CatalogueReconcileReport = {
      kind,
      active: 0,
      created: 0,
      updated: 0,
      archived: 0,
      restored: 0,
    };
    const items = await this.loadActive(kind);
    report.active = items.length;
    const chunks = await this.chunks.find({
      where: {
        collectionId: ClCollectionId.CONTENT_CATALOGUE,
        syncKey: Like(`${CATALOGUE_TABLES[kind]}:%`),
      },
    });
    const byKey = new Map(chunks.map((c) => [c.syncKey!, c]));
    const seen = new Set<string>();
    for (const item of items) {
      const key = catalogueSyncKey(kind, item.id);
      seen.add(key);
      const outcome = await this.apply(key, item, byKey.get(key) ?? null);
      if (outcome) report[outcome]++;
    }
    for (const chunk of chunks) {
      if (seen.has(chunk.syncKey!)) continue;
      const outcome = await this.apply(chunk.syncKey!, null, chunk);
      if (outcome) report[outcome]++;
    }
    return report;
  }

  /**
   * Every kind, one pod at a time. Returns null when another pod holds the run. With `enrich`,
   * the items still waiting for example searches are enriched afterwards, up to a per-run cap.
   */
  async reconcile(
    options: { enrich?: boolean } = {},
  ): Promise<CatalogueReconcileReport[] | null> {
    const locked = await this.redis
      .acquireLock(LOCK_KEY, CL_CATALOGUE_LOCK_TTL_SECONDS)
      .catch(() => true);
    if (!locked) return null;
    try {
      const reports: CatalogueReconcileReport[] = [];
      for (const kind of CATALOGUE_ITEM_KINDS) {
        try {
          reports.push(await this.reconcileKind(kind));
        } catch (error) {
          this.logger.warn(
            `Content Catalogue reconciliation of ${kind} failed: ${(error as Error).message}`,
          );
        }
      }
      const changed = reports.filter(
        (r) => r.created || r.updated || r.archived || r.restored,
      );
      if (changed.length) {
        this.logger.info(
          `Content Catalogue reconciled: ${changed
            .map(
              (r) =>
                `${r.kind} +${r.created} ~${r.updated} -${r.archived} ↺${r.restored}`,
            )
            .join(', ')}`,
        );
      }
      if (options.enrich) await this.enrichPending();
      return reports;
    } finally {
      await this.redis.releaseLock(LOCK_KEY).catch(() => undefined);
    }
  }

  /** The backfill: the reconciliation's first run, while the collection is still empty. */
  async backfillIfEmpty(): Promise<boolean> {
    if (this.stopped) return false;
    const any = await this.chunks.findOne({
      where: {
        collectionId: ClCollectionId.CONTENT_CATALOGUE,
        origin: ClChunkOrigin.SYNCED,
      },
      select: ['id'],
    });
    if (any) return false;
    const reports = await this.reconcile({ enrich: true });
    return reports !== null;
  }

  // ── Enrichment ────────────────────────────────────────────────────────────

  /**
   * Example searches, situations and keywords for synced items still waiting for them. Never
   * touches the statement, facets or attributes the row decides; a failure leaves the item
   * pending for the next run, and it stays findable by its title meanwhile.
   */
  async enrichPending(
    limit = CL_CATALOGUE_ENRICH_PER_RUN,
  ): Promise<{ enriched: number; failed: number }> {
    const totals = { enriched: 0, failed: 0 };
    if (this.enriching || limit <= 0) return totals;
    this.enriching = true;
    try {
      const profile = requireProfile(ClCollectionId.CONTENT_CATALOGUE);
      const pending = await this.chunks
        .createQueryBuilder('c')
        .where('c.collection_id = :id', {
          id: ClCollectionId.CONTENT_CATALOGUE,
        })
        .andWhere('c.status = :status', { status: ClChunkStatus.ACTIVE })
        .andWhere(`c.quality->>'enrichment' = 'pending'`)
        .orderBy('c.createdAt', 'ASC')
        .take(Math.min(limit, CL_CATALOGUE_ENRICH_PER_RUN))
        .getMany();
      for (
        let i = 0;
        i < pending.length && !this.stopped;
        i += CL_CATALOGUE_ENRICH_CONCURRENCY
      ) {
        const results = await Promise.all(
          pending
            .slice(i, i + CL_CATALOGUE_ENRICH_CONCURRENCY)
            .map((chunk) => this.enrichOne(chunk, profile)),
        );
        for (const ok of results) {
          if (ok) totals.enriched++;
          else totals.failed++;
        }
      }
    } finally {
      this.enriching = false;
    }
    return totals;
  }

  private async enrichOne(
    chunk: ClChunk,
    profile: ReturnType<typeof requireProfile>,
  ): Promise<boolean> {
    try {
      // Every facet is passed as known, so enrichment never proposes one: a synced item's
      // facets are its row's.
      const facets = Object.fromEntries(
        Object.keys(profile.facets).map((key) => [
          key,
          chunk.facets?.[key] ?? [],
        ]),
      );
      const enriched = await this.chunkService.enrich(profile, {
        statement: chunk.statement,
        body: null,
        situations: chunk.situations ?? [],
        exampleQueries: (chunk.exampleQueries ?? []).map((q) => q.text),
        keywords: chunk.keywords ?? [],
        topics: chunk.topics ?? [],
        facets,
        attributes: chunk.attributes ?? {},
      });
      if (!enriched.exampleQueries.length) return false;
      chunk.situations = enriched.situations;
      chunk.exampleQueries = [
        ...(chunk.exampleQueries ?? []),
        ...enriched.exampleQueries.filter(
          (q) =>
            !(chunk.exampleQueries ?? []).some(
              (e) => e.text.toLowerCase() === q.text.toLowerCase(),
            ),
        ),
      ];
      chunk.keywords = enriched.keywords;
      chunk.quality = { ...(chunk.quality ?? {}), enrichment: 'done' };
      await this.chunkService.saveChanged(chunk, 'enrich', null);
      return true;
    } catch (error) {
      this.logger.warn(
        `Enriching ${chunk.code} failed: ${(error as Error).message}`,
      );
      return false;
    }
  }

  // ── Status, for the admin page ─────────────────────────────────────────────

  /** Per kind: active rows in Studio, active items here, and items still waiting for enrichment. */
  async status(): Promise<
    Array<{
      kind: CatalogueItemKind;
      sourceActive: number;
      synced: number;
      pendingEnrichment: number;
    }>
  > {
    const counts: Array<{ prefix: string; synced: string; pending: string }> =
      await this.dataSource.query(
        `SELECT split_part(sync_key, ':', 1) AS prefix,
                COUNT(*) FILTER (WHERE status = 'active') AS synced,
                COUNT(*) FILTER (WHERE status = 'active' AND quality->>'enrichment' = 'pending') AS pending
           FROM cl_chunks
          WHERE collection_id = $1 AND origin = 'synced'
          GROUP BY 1`,
        [ClCollectionId.CONTENT_CATALOGUE],
      );
    const out = [];
    for (const kind of CATALOGUE_ITEM_KINDS) {
      const row = counts.find((c) => c.prefix === CATALOGUE_TABLES[kind]);
      out.push({
        kind,
        sourceActive: await this.countActive(kind),
        synced: Number(row?.synced ?? 0),
        pendingEnrichment: Number(row?.pending ?? 0),
      });
    }
    return out;
  }

  private countActive(kind: CatalogueItemKind): Promise<number> {
    switch (kind) {
      case 'roleplay':
        return this.dataSource.getRepository(Scenarios).count({
          where: { status: ScenarioStatus.ACTIVE, deletedAt: IsNull() },
        });
      case 'case':
        return this.dataSource.getRepository(Case).count({
          where: { status: CaseStatus.ACTIVE, deletedAt: IsNull() },
        });
      case 'character':
        return this.dataSource.getRepository(ScenarioCharacter).count();
      case 'template':
        return this.dataSource.getRepository(TrackComponentTemplate).count();
      default:
        return Promise.resolve(0);
    }
  }
}
