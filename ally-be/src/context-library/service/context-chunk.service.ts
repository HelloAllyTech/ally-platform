import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { DataSource, In, Repository } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import { CL_BODY_MAX_CHARS } from '../constants/context-library.constants';
import { ClBulkUpload, ClChunkVersion } from '../entity/cl-chunk-links.entity';
import { ClChunk, ClExampleQuery } from '../entity/cl-chunk.entity';
import { ClSource } from '../entity/cl-source.entity';
import {
  ClBulkUploadStatus,
  ClChunkConfidence,
  ClChunkOrigin,
  ClChunkStatus,
  ClEmbeddingStatus,
} from '../enum/context-library.enum';
import {
  CollectionProfile,
  ProfileChunkView,
  requireProfile,
} from '../profiles';
import {
  ClAudienceFields,
  ClAudienceInput,
  asksForAudience,
  assertTenantsExist,
  resolveAudience,
  sameAudience,
} from '../util/audience.util';
import { AuthoredChunkInput, parseBulkFile } from '../util/bulk.util';
import { runAuthoredGate } from '../util/gate.util';
import { returningRows } from '../util/sql.util';
import { ContextLlmService } from './context-llm.service';

/** Who is writing, and on whose behalf. */
export interface ClActor {
  userId: number | null;
  /** Set for an organisation admin: they may only write their own organisation's chunks. */
  tenantId: string | null;
}

export interface NewChunk {
  collectionId: string;
  origin: ClChunkOrigin;
  statement: string;
  body?: string | null;
  situations?: string[];
  exampleQueries?: ClExampleQuery[];
  keywords?: string[];
  topics?: string[];
  facets?: Record<string, string | string[]>;
  attributes?: Record<string, unknown>;
  citation?: ClChunk['citation'];
  isGlobal?: boolean;
  tenantIds?: string[];
  ownerTenantId?: string | null;
  pinned?: boolean;
  status?: ClChunkStatus;
  confidence?: ClChunkConfidence;
  quality?: Record<string, unknown>;
  distillPromptVersion?: string | null;
  syncKey?: string | null;
  agent?: string | null;
  createdBy?: number | null;
}

const LIST_LIMIT = 50;

export function toView(chunk: ClChunk): ProfileChunkView {
  return {
    code: chunk.code,
    statement: chunk.statement,
    body: chunk.body,
    situations: chunk.situations ?? [],
    exampleQueries: (chunk.exampleQueries ?? []).map((q) => q.text),
    keywords: chunk.keywords ?? [],
    topics: chunk.topics ?? [],
    facets: chunk.facets ?? {},
    attributes: chunk.attributes ?? {},
    citation: chunk.citation ?? null,
  };
}

/** SHA-256 over every field the index holds, so any change re-embeds. */
export function indexHash(chunk: ClChunk, profile: CollectionProfile): string {
  const view = toView(chunk);
  return createHash('sha256')
    .update(
      JSON.stringify([
        profile.statementText(view),
        profile.situationsText(view),
        chunk.body ?? '',
        chunk.keywords,
        chunk.topics,
        chunk.facets,
        chunk.status,
        chunk.isGlobal,
        [...(chunk.tenantIds ?? [])].sort(),
      ]),
    )
    .digest('hex');
}

/**
 * Writing chunks: codes, authored entries (typed or bulk), enrichment, edits.
 *
 * Authored text is stored exactly as written. Enrichment adds retrieval metadata alongside
 * it; it never rewrites `statement` or `body`.
 */
@Injectable()
export class ContextChunkService {
  private readonly logger = LoggerService.getInstance(ContextChunkService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(ClChunk) private readonly chunks: Repository<ClChunk>,
    @InjectRepository(ClChunkVersion)
    private readonly versions: Repository<ClChunkVersion>,
    @InjectRepository(ClBulkUpload)
    private readonly bulkUploads: Repository<ClBulkUpload>,
    private readonly llm: ContextLlmService,
  ) {}

  /** Next code for a collection, e.g. `FP-0142`. Atomic: two writers never share one. */
  async allocateCode(collectionId: string): Promise<string> {
    const result = await this.dataSource.query(
      `UPDATE "cl_collections" SET "next_code" = "next_code" + 1, "updatedAt" = now()
       WHERE "id" = $1 RETURNING "code_prefix", "next_code" - 1 AS n`,
      [collectionId],
    );
    const rows = returningRows<{ code_prefix: string; n: number }>(result);
    if (!rows.length)
      throw new NotFoundException(`Unknown collection "${collectionId}"`);
    const { code_prefix, n } = rows[0];
    return `${code_prefix}-${String(n).padStart(4, '0')}`;
  }

  async create(input: NewChunk): Promise<ClChunk> {
    const profile = requireProfile(input.collectionId);
    if (!profile.allowedOrigins.includes(input.origin)) {
      throw new BadRequestException(
        `${profile.name} does not accept ${input.origin} ${profile.nounPlural}.`,
      );
    }
    const chunk = this.chunks.create({
      collectionId: input.collectionId,
      code: await this.allocateCode(input.collectionId),
      origin: input.origin,
      statement: input.statement.trim(),
      body: input.body ?? null,
      situations: input.situations ?? [],
      exampleQueries: input.exampleQueries ?? [],
      keywords: input.keywords ?? [],
      topics: input.topics ?? [],
      facets: input.facets ?? {},
      attributes: input.attributes ?? {},
      citation: input.citation ?? null,
      isGlobal: input.isGlobal ?? !input.ownerTenantId,
      tenantIds:
        input.tenantIds ?? (input.ownerTenantId ? [input.ownerTenantId] : []),
      ownerTenantId: input.ownerTenantId ?? null,
      pinned: input.pinned ?? false,
      status: input.status ?? ClChunkStatus.ACTIVE,
      confidence: input.confidence ?? ClChunkConfidence.STANDARD,
      quality: input.quality ?? {},
      distillPromptVersion: input.distillPromptVersion ?? null,
      syncKey: input.syncKey ?? null,
      agent: input.agent ?? null,
      embeddingStatus: ClEmbeddingStatus.PENDING,
      createdBy: input.createdBy ?? null,
    });
    chunk.textHash = indexHash(chunk, profile);
    return this.chunks.save(chunk);
  }

  async snapshot(
    chunk: ClChunk,
    reason: string,
    editedBy: number | null,
  ): Promise<void> {
    await this.versions.save(
      this.versions.create({
        chunkId: chunk.id,
        version: chunk.version,
        reason,
        editedBy,
        snapshot: {
          statement: chunk.statement,
          body: chunk.body,
          situations: chunk.situations,
          exampleQueries: chunk.exampleQueries,
          keywords: chunk.keywords,
          topics: chunk.topics,
          facets: chunk.facets,
          attributes: chunk.attributes,
          status: chunk.status,
          confidence: chunk.confidence,
          isGlobal: chunk.isGlobal,
          tenantIds: chunk.tenantIds,
        },
      }),
    );
  }

  /** Save after a change: bump the version, re-hash, re-queue for the index if needed. */
  async saveChanged(
    chunk: ClChunk,
    reason: string,
    editedBy: number | null,
  ): Promise<ClChunk> {
    const profile = requireProfile(chunk.collectionId);
    const hash = indexHash(chunk, profile);
    if (hash !== chunk.textHash) {
      chunk.textHash = hash;
      chunk.embeddingStatus = ClEmbeddingStatus.PENDING;
      chunk.embeddingAttempts = 0;
    }
    chunk.version += 1;
    chunk.editedBy = editedBy;
    const saved = await this.chunks.save(chunk);
    this.logger.debug(`Chunk ${chunk.code} saved (${reason})`);
    return saved;
  }

  async findByCode(code: string): Promise<ClChunk> {
    const chunk = await this.chunks.findOne({ where: { code } });
    if (!chunk) throw new NotFoundException(`No chunk ${code}`);
    return chunk;
  }

  /** Follows superseded codes to the chunk that replaced them. */
  async resolveCodes(codes: string[]): Promise<ClChunk[]> {
    if (!codes.length) return [];
    const found = await this.chunks.find({ where: { code: In(codes) } });
    const out: ClChunk[] = [];
    for (const chunk of found) {
      let current: ClChunk | null = chunk;
      for (
        let hops = 0;
        current?.status === ClChunkStatus.SUPERSEDED &&
        current.supersededById &&
        hops < 5;
        hops++
      ) {
        current = await this.chunks.findOne({
          where: { id: current.supersededById },
        });
      }
      if (current) out.push(current);
    }
    return out;
  }

  assertCanEdit(chunk: ClChunk, actor: ClActor): void {
    if (actor.tenantId && chunk.ownerTenantId !== actor.tenantId) {
      throw new ForbiddenException(
        'You can only change your own organisation’s entries.',
      );
    }
  }

  // ── Authored entries ───────────────────────────────────────────────────────

  private async audienceFor(
    input: ClAudienceInput,
    profile: CollectionProfile,
    actor: ClActor,
    fallback?: ClAudienceFields,
  ) {
    if (actor.tenantId) {
      if (!profile.allowsOrgChunks) {
        throw new ForbiddenException(
          `${profile.name} does not take organisation entries.`,
        );
      }
      // An organisation admin can only ever target their own organisation.
      return {
        isGlobal: false,
        tenantIds: [actor.tenantId],
        ownerTenantId: actor.tenantId,
      };
    }
    // A platform admin writes on behalf of any organisations, or for every one.
    const audience = resolveAudience(input, fallback);
    await assertTenantsExist(this.dataSource.manager, audience.tenantIds);
    return { ...audience, ownerTenantId: null };
  }

  /**
   * Who a platform admin may re-target. An organisation's own entry reaches that organisation
   * by definition, and a Studio-synced item follows its item's owner on every sync, so neither
   * is set here.
   */
  private assertAudienceEditable(chunk: ClChunk): void {
    if (chunk.ownerTenantId) {
      throw new BadRequestException(
        'This entry belongs to an organisation, so it reaches that organisation only.',
      );
    }
    if (chunk.origin === ClChunkOrigin.SYNCED) {
      throw new BadRequestException(
        'This item is synced from Studio; who it reaches follows its owner there.',
      );
    }
  }

  /**
   * Re-target any chunk the platform owns — written, bulk-uploaded or distilled from a
   * document. Platform admins only: organisation admins' entries always reach their own.
   */
  async setAudience(
    code: string,
    input: ClAudienceInput,
    actor: ClActor,
  ): Promise<ClChunk> {
    if (actor.tenantId) {
      throw new ForbiddenException(
        'Only a platform admin can choose which organisations an entry reaches.',
      );
    }
    const chunk = await this.findByCode(code);
    this.assertAudienceEditable(chunk);
    const audience = resolveAudience(input, chunk);
    await assertTenantsExist(this.dataSource.manager, audience.tenantIds);
    if (sameAudience(audience, chunk)) return chunk;
    await this.snapshot(chunk, 'audience', actor.userId);
    chunk.isGlobal = audience.isGlobal;
    chunk.tenantIds = audience.tenantIds;
    return this.saveChanged(chunk, 'audience', actor.userId);
  }

  async createAuthored(
    collectionId: string,
    input: AuthoredChunkInput,
    actor: ClActor,
    origin: ClChunkOrigin = ClChunkOrigin.AUTHORED,
  ): Promise<ClChunk> {
    const profile = requireProfile(collectionId);
    const findings = runAuthoredGate(profile, input, {
      bodyMaxChars: CL_BODY_MAX_CHARS,
    });
    if (findings.length) {
      throw new BadRequestException({
        message: 'This entry needs fixing before it can be saved.',
        findings,
      });
    }
    // Before enrichment, so a bad organisation id costs no model call.
    const audience = await this.audienceFor(input, profile, actor);
    const enriched = await this.enrich(profile, input);
    return this.create({
      collectionId,
      origin,
      statement: enriched.statement,
      body: input.body ?? null,
      situations: enriched.situations,
      exampleQueries: enriched.exampleQueries,
      keywords: enriched.keywords,
      topics: input.topics,
      facets: enriched.facets,
      attributes: input.attributes,
      citation: input.citation ?? null,
      pinned: input.pinned ?? false,
      createdBy: actor.userId,
      ...audience,
    });
  }

  async updateAuthored(
    code: string,
    input: AuthoredChunkInput,
    actor: ClActor,
  ): Promise<ClChunk> {
    const chunk = await this.findByCode(code);
    this.assertCanEdit(chunk, actor);
    const profile = requireProfile(chunk.collectionId);
    if (chunk.origin === ClChunkOrigin.SYNCED) {
      throw new BadRequestException(
        'This item is synced from Studio; edit it there.',
      );
    }
    const findings = runAuthoredGate(profile, input, {
      bodyMaxChars: CL_BODY_MAX_CHARS,
    });
    if (findings.length) {
      throw new BadRequestException({
        message: 'This entry needs fixing before it can be saved.',
        findings,
      });
    }
    // Checked before anything is written, so a refused audience leaves no stray version.
    let audience: ClAudienceFields | null = null;
    if (!actor.tenantId && asksForAudience(input)) {
      const asked = await this.audienceFor(input, profile, actor, chunk);
      if (!sameAudience(asked, chunk)) {
        this.assertAudienceEditable(chunk);
        audience = asked;
      }
    }
    await this.snapshot(chunk, 'edit', actor.userId);
    chunk.statement = input.statement.trim();
    chunk.body = input.body ?? null;
    if (input.situations.length) chunk.situations = input.situations;
    if (input.keywords.length) chunk.keywords = input.keywords;
    if (input.topics.length) chunk.topics = input.topics;
    chunk.facets = { ...chunk.facets, ...input.facets };
    chunk.attributes = { ...chunk.attributes, ...input.attributes };
    if (input.pinned !== undefined) chunk.pinned = input.pinned;
    if (input.citation !== undefined) chunk.citation = input.citation;
    if (audience) {
      chunk.isGlobal = audience.isGlobal;
      chunk.tenantIds = audience.tenantIds;
    }
    return this.saveChanged(chunk, 'edit', actor.userId);
  }

  async setStatus(
    code: string,
    status: ClChunkStatus.ACTIVE | ClChunkStatus.ARCHIVED,
    actor: ClActor,
  ) {
    const chunk = await this.findByCode(code);
    this.assertCanEdit(chunk, actor);
    if (chunk.origin === ClChunkOrigin.SYNCED) {
      // The sync would undo it: an item is archived or restored by its row, in Studio.
      throw new BadRequestException(
        'This item is synced from Studio; archive or restore it there.',
      );
    }
    if (chunk.status === status) return chunk;
    await this.snapshot(
      chunk,
      status === ClChunkStatus.ARCHIVED ? 'archive' : 'restore',
      actor.userId,
    );
    chunk.status = status;
    return this.saveChanged(chunk, status, actor.userId);
  }

  async setPinned(code: string, pinned: boolean, actor: ClActor) {
    const chunk = await this.findByCode(code);
    this.assertCanEdit(chunk, actor);
    chunk.pinned = pinned;
    return this.chunks.save(chunk);
  }

  // ── Enrichment ─────────────────────────────────────────────────────────────

  /**
   * Retrieval metadata for an authored entry. Admin-typed values always win: enrichment only
   * fills what is missing, and never touches the statement or body the admin wrote (except
   * to supply a one-line statement when there is none). A failed call leaves the entry
   * saveable — it just has less to be found by until it is edited.
   */
  async enrich(profile: CollectionProfile, input: AuthoredChunkInput) {
    const missingFacets = Object.entries(profile.facets)
      .filter(([key]) => input.facets?.[key] === undefined)
      .map(([key, spec]) => ({
        key,
        label: spec.label,
        values: spec.values ?? null,
        multi: spec.multi,
      }));
    const needStatement = !input.statement?.trim();
    const needs =
      needStatement ||
      !input.situations.length ||
      !input.exampleQueries.length ||
      missingFacets.length;
    const base = {
      statement: input.statement?.trim() ?? '',
      situations: input.situations,
      exampleQueries: input.exampleQueries.map(
        (text): ClExampleQuery => ({ text, origin: 'enriched' }),
      ),
      keywords: input.keywords,
      facets: { ...input.facets },
    };
    if (!needs) return base;
    try {
      const { value } = await this.llm.enrich<{
        statement?: string | null;
        situations?: string[];
        exampleQueries?: string[];
        keywords?: string[];
        facets?: Record<string, string | string[]>;
      }>(
        JSON.stringify({
          collection: profile.name,
          noun: profile.noun,
          statementMaxChars: profile.statementMaxChars,
          needStatement,
          missingFacets,
          entry: {
            statement: input.statement,
            body: input.body ?? null,
            keywords: input.keywords,
          },
        }),
      );
      if (!value) return base;
      const facets = { ...base.facets };
      for (const { key, values, multi } of missingFacets) {
        const proposed = value.facets?.[key];
        const list = (
          Array.isArray(proposed) ? proposed : proposed ? [proposed] : []
        ).filter((v) => !values || values.includes(v));
        if (list.length) facets[key] = multi ? list : list[0];
      }
      return {
        statement:
          base.statement ||
          String(value.statement ?? '')
            .slice(0, profile.statementMaxChars)
            .trim(),
        situations: base.situations.length
          ? base.situations
          : (value.situations ?? []).slice(0, 4),
        exampleQueries: base.exampleQueries.length
          ? base.exampleQueries
          : (value.exampleQueries ?? [])
              .slice(0, 5)
              .map((text): ClExampleQuery => ({ text, origin: 'enriched' })),
        keywords: Array.from(
          new Set([...base.keywords, ...(value.keywords ?? [])]),
        ).slice(0, 20),
        facets,
      };
    } catch (error) {
      this.logger.warn(
        `Enrichment failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return base;
    }
  }

  // ── Bulk upload ────────────────────────────────────────────────────────────

  /**
   * Dry run or apply a bulk file. The dry run reports what would happen row by row; apply
   * runs the same parse and writes. Rows with a `code` update that chunk; others create.
   */
  async bulk(
    collectionId: string,
    fileName: string,
    buffer: Buffer,
    actor: ClActor,
    apply: boolean,
    /**
     * Platform admins: who new rows reach when a row leaves `is_global` and `tenant_ids`
     * blank. Rows that update an entry keep its audience unless they set one.
     */
    defaultAudience: ClAudienceInput = {},
  ) {
    const profile = requireProfile(collectionId);
    if (!profile.allowedOrigins.includes(ClChunkOrigin.AUTHORED)) {
      throw new BadRequestException(
        `${profile.name} does not take written entries.`,
      );
    }
    let parsed;
    try {
      parsed = parseBulkFile(profile, fileName, buffer);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : String(error),
      );
    }
    const codes = parsed.rows
      .map((r) => r.input.code)
      .filter(Boolean) as string[];
    const existing = codes.length
      ? await this.chunks.find({ where: { code: In(codes) } })
      : [];
    const byCode = new Map(existing.map((c) => [c.code, c]));
    const rejected = [...parsed.rejected];
    // Organisation admins' rows are always their own organisation's; the columns are ignored.
    const fallback = actor.tenantId ? null : resolveAudience(defaultAudience);
    if (fallback) {
      await assertTenantsExist(this.dataSource.manager, fallback.tenantIds);
    }
    const knownTenants = fallback
      ? await this.existingTenants(
          parsed.rows.flatMap((r) => r.input.tenantIds ?? []),
        )
      : new Set<string>();
    const plan: Array<{
      row: number;
      action: 'create' | 'update';
      input: AuthoredChunkInput;
    }> = [];
    for (const { row, input } of parsed.rows) {
      if (input.code) {
        const chunk = byCode.get(input.code);
        if (!chunk || chunk.collectionId !== collectionId) {
          rejected.push({
            row,
            reason: `code ${input.code} is not in ${profile.name}`,
          });
          continue;
        }
        if (actor.tenantId && chunk.ownerTenantId !== actor.tenantId) {
          rejected.push({
            row,
            reason: `${input.code} belongs to another organisation`,
          });
          continue;
        }
        if (fallback && asksForAudience(input)) {
          const reason =
            this.rowAudienceProblem(input, chunk, knownTenants) ??
            (chunk.ownerTenantId || chunk.origin === ClChunkOrigin.SYNCED
              ? `${input.code}'s audience can't be changed here`
              : null);
          if (reason) {
            rejected.push({ row, reason });
            continue;
          }
        }
        plan.push({ row, action: 'update', input });
      } else {
        if (fallback) {
          const reason = this.rowAudienceProblem(input, fallback, knownTenants);
          if (reason) {
            rejected.push({ row, reason });
            continue;
          }
          if (!asksForAudience(input)) {
            input.isGlobal = fallback.isGlobal;
            input.tenantIds = fallback.tenantIds;
          }
        }
        plan.push({ row, action: 'create', input });
      }
    }

    let created = 0;
    let updated = 0;
    if (apply) {
      // Small parallel batches: each create enriches with one fast-model call.
      for (let i = 0; i < plan.length; i += 5) {
        const batch = plan.slice(i, i + 5);
        const results = await Promise.allSettled(
          batch.map((p) =>
            p.action === 'create'
              ? this.createAuthored(collectionId, p.input, actor)
              : this.updateAuthored(p.input.code!, p.input, actor),
          ),
        );
        results.forEach((r, j) => {
          if (r.status === 'fulfilled') {
            if (batch[j].action === 'create') created++;
            else updated++;
          } else {
            rejected.push({
              row: batch[j].row,
              reason:
                r.reason instanceof Error ? r.reason.message : String(r.reason),
            });
          }
        });
      }
    }

    const record = await this.bulkUploads.save(
      this.bulkUploads.create({
        collectionId,
        fileName,
        rowCount: parsed.rows.length + parsed.rejected.length,
        createdCount: apply
          ? created
          : plan.filter((p) => p.action === 'create').length,
        updatedCount: apply
          ? updated
          : plan.filter((p) => p.action === 'update').length,
        rejected: rejected.sort((a, b) => a.row - b.row),
        status: apply ? ClBulkUploadStatus.APPLIED : ClBulkUploadStatus.DRY_RUN,
        ownerTenantId: actor.tenantId,
        uploadedBy: actor.userId,
      }),
    );
    return {
      id: record.id,
      applied: apply,
      toCreate: record.createdCount,
      toUpdate: record.updatedCount,
      rejected: record.rejected,
    };
  }

  /**
   * Re-target a document: its own audience, which later re-extractions inherit, and every
   * chunk distilled from it alone. A chunk other documents also back keeps its audience and is
   * counted as `shared` (re-target it on its own), so retargeting one document never narrows
   * what another document's readers see.
   */
  async setSourceAudience(
    sourceId: string,
    input: ClAudienceInput,
    actor: ClActor,
  ): Promise<{ source: ClSource; updated: number; shared: number }> {
    if (actor.tenantId) {
      throw new ForbiddenException(
        'Only a platform admin can choose which organisations a document reaches.',
      );
    }
    const sources = this.dataSource.getRepository(ClSource);
    const source = await sources.findOne({ where: { id: sourceId } });
    if (!source) throw new NotFoundException('No such document.');
    if (source.ownerTenantId) {
      throw new BadRequestException(
        'This document belongs to an organisation, so it reaches that organisation only.',
      );
    }
    const audience = resolveAudience(input, source);
    await assertTenantsExist(this.dataSource.manager, audience.tenantIds);
    source.isGlobal = audience.isGlobal;
    source.tenantIds = audience.tenantIds;
    await sources.save(source);

    const linked = await this.chunks
      .createQueryBuilder('c')
      .where(
        'EXISTS (SELECT 1 FROM cl_chunk_sources s WHERE s.chunk_id = c.id AND s.source_id = :sourceId)',
        { sourceId },
      )
      .andWhere('c.owner_tenant_id IS NULL')
      .andWhere('c.origin != :synced', { synced: ClChunkOrigin.SYNCED })
      .andWhere('c.status != :superseded', {
        superseded: ClChunkStatus.SUPERSEDED,
      })
      .getMany();
    let updated = 0;
    let shared = 0;
    for (const chunk of linked) {
      if (chunk.sourceCount > 1) {
        shared++;
        continue;
      }
      if (sameAudience(audience, chunk)) continue;
      await this.snapshot(chunk, 'audience', actor.userId);
      chunk.isGlobal = audience.isGlobal;
      chunk.tenantIds = audience.tenantIds;
      await this.saveChanged(chunk, 'audience', actor.userId);
      updated++;
    }
    return { source, updated, shared };
  }

  /** The ids among these that name an organisation, in one query for a whole file. */
  private async existingTenants(ids: string[]): Promise<Set<string>> {
    const unique = [...new Set(ids.filter(Boolean))];
    if (!unique.length) return new Set();
    const found: Array<{ id: string }> = await this.dataSource.query(
      `SELECT id::text AS id FROM tenants WHERE id::text = ANY($1::text[])`,
      [unique],
    );
    return new Set(found.map((r) => r.id));
  }

  /** Why a bulk row's audience can't be used, so the dry run says so beside the row. */
  private rowAudienceProblem(
    input: ClAudienceInput,
    fallback: ClAudienceFields,
    knownTenants: Set<string>,
  ): string | null {
    let audience: ClAudienceFields;
    try {
      audience = resolveAudience(input, fallback);
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
    const missing = audience.tenantIds.filter((id) => !knownTenants.has(id));
    return missing.length
      ? `no such organisation: ${missing.join(', ')}`
      : null;
  }

  // ── Library listing (Postgres; the search box uses the retrieval pipeline) ─

  async list(params: {
    collectionId?: string;
    status?: ClChunkStatus;
    origin?: ClChunkOrigin;
    confidence?: ClChunkConfidence;
    sourceId?: string;
    q?: string;
    /**
     * An organisation admin's scope: that organisation's own entries, the global ones, and
     * those a platform admin targeted at it. `null` is the platform's own entries only.
     */
    ownerTenantId?: string | null;
    /** Only entries every learner may read. */
    globalOnly?: boolean;
    /** Only entries that reach this organisation by name (its own, or targeted at it). */
    audienceTenantId?: string;
    /** Only this organisation's own entries. */
    ownedBy?: string;
    offset?: number;
    limit?: number;
  }) {
    const qb = this.chunks.createQueryBuilder('c');
    if (params.collectionId)
      qb.andWhere('c.collection_id = :cid', { cid: params.collectionId });
    qb.andWhere('c.status = :status', {
      status: params.status ?? ClChunkStatus.ACTIVE,
    });
    if (params.origin)
      qb.andWhere('c.origin = :origin', { origin: params.origin });
    if (params.confidence)
      qb.andWhere('c.confidence = :conf', { conf: params.confidence });
    if (params.ownerTenantId !== undefined) {
      if (params.ownerTenantId === null)
        qb.andWhere('c.owner_tenant_id IS NULL');
      else
        qb.andWhere(
          // Two names for one id: owner_tenant_id is uuid, tenant_ids text[].
          '(c.owner_tenant_id = :owner OR c.is_global = true OR :ownerText = ANY(c.tenant_ids))',
          { owner: params.ownerTenantId, ownerText: params.ownerTenantId },
        );
    }
    if (params.globalOnly) qb.andWhere('c.is_global = true');
    if (params.audienceTenantId) {
      qb.andWhere('c.is_global = false AND :aud = ANY(c.tenant_ids)', {
        aud: params.audienceTenantId,
      });
    }
    if (params.ownedBy) {
      qb.andWhere('c.owner_tenant_id = :ownedBy', { ownedBy: params.ownedBy });
    }
    if (params.sourceId) {
      qb.andWhere(
        'EXISTS (SELECT 1 FROM cl_chunk_sources s WHERE s.chunk_id = c.id AND s.source_id = :sid)',
        { sid: params.sourceId },
      );
    }
    if (params.q?.trim()) {
      qb.andWhere(
        '(c.statement ILIKE :q OR c.code ILIKE :q OR c.body ILIKE :q)',
        {
          q: `%${params.q.trim().replace(/[%_]/g, '\\$&')}%`,
        },
      );
    }
    qb.orderBy('c.createdAt', 'DESC')
      .skip(params.offset ?? 0)
      .take(Math.min(params.limit ?? LIST_LIMIT, 200));
    const [items, total] = await qb.getManyAndCount();
    return { items, total };
  }
}
