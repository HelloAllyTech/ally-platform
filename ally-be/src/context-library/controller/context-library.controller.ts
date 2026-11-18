import {
  Body,
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { InjectRepository } from '@nestjs/typeorm';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { In, Repository } from 'typeorm';
import { RequireFeatureToggle } from 'src/auth/decorators/feature-toggle.decorator';
import { CurrentUser } from 'src/auth/decorators/user.decorator';
import { TokenUser } from 'src/auth/type/auth.types';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import {
  CL_BULK_MAX_BYTES,
  CL_UPLOAD_MAX_BYTES,
  CL_UPLOAD_MAX_FILES,
} from '../constants/context-library.constants';
import {
  ContextAudienceDto,
  ContextAuthoredChunkDto,
  ContextBulkDto,
  ContextChunkListQueryDto,
  ContextGrantDto,
  ContextLoopSettingsDto,
  ContextResumeDto,
  ContextRetireCorpusDto,
  ContextSearchDto,
  ContextUploadDto,
} from '../dto/context-library.dto';
import { ClChunkSource } from '../entity/cl-chunk-links.entity';
import { ClChunk } from '../entity/cl-chunk.entity';
import { ClCollection } from '../entity/cl-collection.entity';
import { ClSource } from '../entity/cl-source.entity';
import { ClChunkStatus, ClUseCase } from '../enum/context-library.enum';
import { COLLECTION_PROFILES, requireProfile } from '../profiles';
import { templateCsv } from '../util/bulk.util';
import { ContextAccessService } from '../service/context-access.service';
import { ContextCatalogueSyncService } from '../service/context-catalogue-sync.service';
import { ClActor, ContextChunkService } from '../service/context-chunk.service';
import { ContextRetrievalService } from '../service/context-retrieval.service';
import { ContextUploadService } from '../service/context-upload.service';
import { ContextGapsService } from '../service/context-gaps.service';
import { ContextKbCopyService } from '../service/context-kb-copy.service';
import {
  ALLY_GUIDE_CORPUS_MIGRATION,
  CHARACTER_CORPUS_MIGRATION,
  ContextKbImportService,
  DEBRIEF_CORPUS_MIGRATION,
  KbCorpusMigration,
} from '../service/context-kb-import.service';
import { ContextLoopActionsService } from '../service/context-loop-actions.service';
import { ContextLoopsService } from '../service/context-loops.service';
import { ContextLibraryRolloutService } from '../service/context-library-rollout.service';

const VIEW = { permissions: [PERMISSIONS.VIEW_CONTEXT_LIBRARY] };
const EDIT = { permissions: [PERMISSIONS.EDIT_CONTEXT_LIBRARY] };

/**
 * Everyone on these routes acts for the platform. The Context Library toggle is platform-only, so
 * an admin restricted to some organisations never reaches them; organisation admins use the
 * organisation routes (`ContextLibraryOrgController`), where the route names the organisation.
 */
function actorFor(user: TokenUser): ClActor {
  return { userId: user?.id ?? null, tenantId: null };
}

/** One chunk with the documents it was distilled from (title, version, year and location). */
export async function chunkDetail(
  chunk: ClChunk,
  chunkSources: Repository<ClChunkSource>,
  sources: Repository<ClSource>,
) {
  const links = await chunkSources.find({ where: { chunkId: chunk.id } });
  const found = links.length
    ? await sources.find({
        where: { id: In(links.map((l) => l.sourceId)) },
        select: ['id', 'title', 'docVersion', 'year'],
      })
    : [];
  return {
    ...chunk,
    sources: links.map((l) => ({
      ...found.find((s) => s.id === l.sourceId),
      sectionPath: l.sectionPath,
      pageFrom: l.pageFrom,
      pageTo: l.pageTo,
    })),
  };
}

export function toAuthoredInput(dto: ContextAuthoredChunkDto) {
  return {
    statement: dto.statement,
    body: dto.body ?? null,
    situations: dto.situations ?? [],
    exampleQueries: dto.exampleQueries ?? [],
    keywords: dto.keywords ?? [],
    topics: dto.topics ?? [],
    facets: dto.facets ?? {},
    attributes: dto.attributes ?? {},
    isGlobal: dto.isGlobal,
    tenantIds: dto.tenantIds,
    pinned: dto.pinned,
  };
}

@ApiTags('Context Library')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('v1/context-library')
export class ContextLibraryController {
  constructor(
    private readonly uploads: ContextUploadService,
    private readonly chunkService: ContextChunkService,
    private readonly access: ContextAccessService,
    private readonly retrieval: ContextRetrievalService,
    @InjectRepository(ClCollection)
    private readonly collections: Repository<ClCollection>,
    @InjectRepository(ClSource) private readonly sources: Repository<ClSource>,
    @InjectRepository(ClChunkSource)
    private readonly chunkSources: Repository<ClChunkSource>,
    private readonly loops: ContextLoopsService,
    private readonly loopActions: ContextLoopActionsService,
    private readonly gaps: ContextGapsService,
    private readonly kbImport: ContextKbImportService,
    private readonly kbCopy: ContextKbCopyService,
    private readonly catalogue: ContextCatalogueSyncService,
    private readonly rollout: ContextLibraryRolloutService,
  ) {}

  // ── Collections ────────────────────────────────────────────────────────────

  @Get('collections')
  @RequireFeatureToggle(FeatureToggleKey.CONTEXT_LIBRARY, VIEW)
  @ApiOperation({
    summary:
      'Collections with their profile (fields, vocabularies, noun) and counts',
  })
  async listCollections() {
    const rows = await this.collections.find({ order: { name: 'ASC' } });
    const counts: Array<{ collection_id: string; status: string; n: string }> =
      await this.collections.manager.query(
        `SELECT collection_id, status, COUNT(*) AS n FROM cl_chunks GROUP BY collection_id, status`,
      );
    return rows
      .filter(
        (r) => COLLECTION_PROFILES[r.id as keyof typeof COLLECTION_PROFILES],
      )
      .map((r) => {
        const profile = requireProfile(r.id);
        return {
          id: r.id,
          name: profile.name,
          noun: profile.noun,
          nounPlural: profile.nounPlural,
          codePrefix: profile.codePrefix,
          allowedOrigins: profile.allowedOrigins,
          allowsOrgChunks: profile.allowsOrgChunks,
          takesDocuments: Boolean(profile.extraction),
          facets: profile.facets,
          attributes: profile.attributes,
          statementMaxChars: profile.statementMaxChars,
          activeIndexVersion: r.activeIndexVersion,
          counts: Object.fromEntries(
            counts
              .filter((c) => c.collection_id === r.id)
              .map((c) => [c.status, Number(c.n)]),
          ),
        };
      });
  }

  @Get('collections/:id/template.csv')
  @RequireFeatureToggle(FeatureToggleKey.CONTEXT_LIBRARY, VIEW)
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @ApiOperation({ summary: 'The bulk-upload template for one collection' })
  template(@Param('id') id: string) {
    return templateCsv(requireProfile(id));
  }

  // ── Documents ──────────────────────────────────────────────────────────────

  @Post('uploads')
  @RequireFeatureToggle(FeatureToggleKey.CONTEXT_LIBRARY, EDIT)
  @UseInterceptors(
    FilesInterceptor('files', CL_UPLOAD_MAX_FILES, {
      limits: { fileSize: CL_UPLOAD_MAX_BYTES },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Add documents',
    description:
      'Each file is read in memory, parsed, split into parts and queued; the file itself is ' +
      'never stored. Duplicates and unreadable files are reported per file and skipped.',
  })
  upload(
    @CurrentUser() user: TokenUser,
    @UploadedFiles() files: Express.Multer.File[],
    @Body() dto: ContextUploadDto,
  ) {
    return this.uploads.upload(files, dto, actorFor(user));
  }

  @Get('queue')
  @RequireFeatureToggle(FeatureToggleKey.CONTEXT_LIBRARY, VIEW)
  @ApiOperation({
    summary: 'Documents being extracted, in queue order, with progress',
  })
  queue() {
    return this.uploads.queue();
  }

  @Post('sources/:id/pause')
  @RequireFeatureToggle(FeatureToggleKey.CONTEXT_LIBRARY, EDIT)
  pause(@Param('id', ParseUUIDPipe) id: string) {
    return this.uploads.pause(id);
  }

  @Post('sources/:id/resume')
  @RequireFeatureToggle(FeatureToggleKey.CONTEXT_LIBRARY, EDIT)
  resume(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ContextResumeDto,
  ) {
    return this.uploads.resume(id, dto?.raiseCapBy);
  }

  @Post('sources/:id/cancel')
  @RequireFeatureToggle(FeatureToggleKey.CONTEXT_LIBRARY, EDIT)
  cancel(@Param('id', ParseUUIDPipe) id: string) {
    return this.uploads.cancel(id);
  }

  @Post('sources/:id/front')
  @RequireFeatureToggle(FeatureToggleKey.CONTEXT_LIBRARY, EDIT)
  moveToFront(@Param('id', ParseUUIDPipe) id: string) {
    return this.uploads.moveToFront(id);
  }

  @Post('sources/:id/retry')
  @RequireFeatureToggle(FeatureToggleKey.CONTEXT_LIBRARY, EDIT)
  retry(@Param('id', ParseUUIDPipe) id: string) {
    return this.uploads.retryFailed(id);
  }

  @Put('sources/:id/audience')
  @RequireFeatureToggle(FeatureToggleKey.CONTEXT_LIBRARY, EDIT)
  @ApiOperation({
    summary: 'Choose which organisations a document’s entries reach',
    description:
      'Sets the document’s audience (re-extractions inherit it) and applies it to every entry ' +
      'distilled from this document alone. Entries other documents also back keep theirs and ' +
      'are counted as `shared`.',
  })
  async setSourceAudience(
    @CurrentUser() user: TokenUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ContextAudienceDto,
  ) {
    const { source, updated, shared } =
      await this.chunkService.setSourceAudience(id, dto, actorFor(user));
    return {
      id: source.id,
      isGlobal: source.isGlobal,
      tenantIds: source.tenantIds,
      updated,
      shared,
    };
  }

  @Get('sources')
  @RequireFeatureToggle(FeatureToggleKey.CONTEXT_LIBRARY, VIEW)
  @ApiOperation({
    summary: 'Documents: title, collections, cost, overview and yield report',
  })
  listSources(@Query('collectionId') collectionId?: string) {
    const qb = this.sources
      .createQueryBuilder('s')
      .orderBy('s.createdAt', 'DESC')
      .take(200);
    if (collectionId)
      qb.where(':cid = ANY(s.target_collections)', { cid: collectionId });
    return qb.getMany();
  }

  @Get('sources/:id')
  @RequireFeatureToggle(FeatureToggleKey.CONTEXT_LIBRARY, VIEW)
  async getSource(@Param('id', ParseUUIDPipe) id: string) {
    const source = await this.sources.findOne({ where: { id } });
    if (!source) throw new NotFoundException();
    return source;
  }

  // ── Chunks ────────────────────────────────────────────────────────────────

  @Get('chunks')
  @RequireFeatureToggle(FeatureToggleKey.CONTEXT_LIBRARY, VIEW)
  @ApiOperation({
    summary: 'Entries, newest first',
    description:
      '`audience` narrows to `global` entries, or to those reaching one organisation (its id).',
  })
  listChunks(@Query() dto: ContextChunkListQueryDto) {
    const { audience, ...rest } = dto;
    // `mine` is an organisation admin's word; the platform has no organisation of its own.
    return this.chunkService.list({
      ...rest,
      ...(audience === 'global'
        ? { globalOnly: true }
        : audience && audience !== 'mine'
          ? { audienceTenantId: audience }
          : {}),
    });
  }

  @Get('chunks/:code')
  @RequireFeatureToggle(FeatureToggleKey.CONTEXT_LIBRARY, VIEW)
  async getChunk(@Param('code') code: string) {
    const chunk = await this.chunkService.findByCode(code);
    return chunkDetail(chunk, this.chunkSources, this.sources);
  }

  @Post('collections/:id/chunks')
  @RequireFeatureToggle(FeatureToggleKey.CONTEXT_LIBRARY, EDIT)
  @ApiOperation({
    summary:
      'Write an entry. Stored exactly as written; enrichment adds search metadata alongside.',
  })
  createChunk(
    @CurrentUser() user: TokenUser,
    @Param('id') collectionId: string,
    @Body() dto: ContextAuthoredChunkDto,
  ) {
    return this.chunkService.createAuthored(
      collectionId,
      toAuthoredInput(dto),
      actorFor(user),
    );
  }

  @Patch('chunks/:code')
  @RequireFeatureToggle(FeatureToggleKey.CONTEXT_LIBRARY, EDIT)
  updateChunk(
    @CurrentUser() user: TokenUser,
    @Param('code') code: string,
    @Body() dto: ContextAuthoredChunkDto,
  ) {
    return this.chunkService.updateAuthored(
      code,
      toAuthoredInput(dto),
      actorFor(user),
    );
  }

  @Post('chunks/:code/archive')
  @RequireFeatureToggle(FeatureToggleKey.CONTEXT_LIBRARY, EDIT)
  archive(@CurrentUser() user: TokenUser, @Param('code') code: string) {
    return this.chunkService.setStatus(
      code,
      ClChunkStatus.ARCHIVED,
      actorFor(user),
    );
  }

  @Post('chunks/:code/restore')
  @RequireFeatureToggle(FeatureToggleKey.CONTEXT_LIBRARY, EDIT)
  restore(@CurrentUser() user: TokenUser, @Param('code') code: string) {
    return this.chunkService.setStatus(
      code,
      ClChunkStatus.ACTIVE,
      actorFor(user),
    );
  }

  @Post('chunks/:code/pin')
  @RequireFeatureToggle(FeatureToggleKey.CONTEXT_LIBRARY, EDIT)
  pin(@CurrentUser() user: TokenUser, @Param('code') code: string) {
    return this.chunkService.setPinned(code, true, actorFor(user));
  }

  @Post('chunks/:code/unpin')
  @RequireFeatureToggle(FeatureToggleKey.CONTEXT_LIBRARY, EDIT)
  unpin(@CurrentUser() user: TokenUser, @Param('code') code: string) {
    return this.chunkService.setPinned(code, false, actorFor(user));
  }

  @Put('chunks/:code/audience')
  @RequireFeatureToggle(FeatureToggleKey.CONTEXT_LIBRARY, EDIT)
  @ApiOperation({
    summary: 'Choose which organisations an entry reaches',
    description:
      'Every organisation, or only those named. Any entry Ally owns — written, bulk-uploaded ' +
      'or distilled from a document; an organisation’s own entries and Studio-synced items ' +
      'follow their owner and are refused.',
  })
  setChunkAudience(
    @CurrentUser() user: TokenUser,
    @Param('code') code: string,
    @Body() dto: ContextAudienceDto,
  ) {
    return this.chunkService.setAudience(code, dto, actorFor(user));
  }

  @Post('bulk')
  @RequireFeatureToggle(FeatureToggleKey.CONTEXT_LIBRARY, EDIT)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: CL_BULK_MAX_BYTES } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Bulk-upload entries (CSV or JSON)',
    description:
      'A dry run by default: send apply="true" to write. Rows with a code update that entry.',
  })
  bulk(
    @CurrentUser() user: TokenUser,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: ContextBulkDto,
  ) {
    return this.chunkService.bulk(
      dto.collectionId,
      file?.originalname ?? 'upload',
      file?.buffer ?? Buffer.alloc(0),
      actorFor(user),
      dto.apply === 'true',
      { isGlobal: dto.isGlobal, tenantIds: dto.tenantIds },
    );
  }

  // ── Search (the Library search box; admin_preview, excluded from usage) ──

  @Post('search')
  @RequireFeatureToggle(FeatureToggleKey.CONTEXT_LIBRARY, VIEW)
  @ApiOperation({
    summary: 'Search the library with the real pipeline',
    description:
      'Fast by default (no re-rank), so results never reshuffle under the cursor; `explain` adds ' +
      'per-candidate diagnostics and `rerank` runs the graded re-rank to compare.',
  })
  async search(@Body() dto: ContextSearchDto) {
    const response = await this.retrieval.search({
      useCase: ClUseCase.ADMIN_PREVIEW,
      queries: [dto.query],
      collections: dto.collectionId ? [dto.collectionId] : undefined,
      limit: dto.limit ?? 20,
      explain: Boolean(dto.explain),
      fast: !dto.rerank,
      queryOrigin: 'human',
    });
    return {
      results: response.results.map((r) => ({
        chunk: r.chunk,
        band: r.band,
        score: r.score,
        diagnostics: r.diagnostics,
      })),
      noConfidentMatch: response.noConfidentMatch,
    };
  }

  // ── Settings ──────────────────────────────────────────────────────────────

  @Get('settings/use-cases')
  @RequireFeatureToggle(FeatureToggleKey.CONTEXT_LIBRARY, VIEW)
  @ApiOperation({
    summary: 'Which use case may read which collection (locks included)',
  })
  useCases() {
    return this.access.matrix();
  }

  @Put('settings/use-cases')
  @RequireFeatureToggle(FeatureToggleKey.CONTEXT_LIBRARY, EDIT)
  setGrant(@CurrentUser() user: TokenUser, @Body() dto: ContextGrantDto) {
    return this.access.setGrant(
      dto.useCase,
      dto.collectionId,
      dto.enabled,
      dto.weight,
      user?.id ?? null,
    );
  }

  // ── Insights and the learning loops ────────────────────────────────────────

  @Get('collections/:id/insights')
  @RequireFeatureToggle(FeatureToggleKey.CONTEXT_LIBRARY, VIEW)
  @ApiOperation({
    summary:
      "Is it helping, what's missing, what changed, and never-useful written entries",
  })
  insights(@Param('id') id: string, @Query('days') days?: string) {
    requireProfile(id);
    return this.loops.insights(id, days ? Number(days) || 30 : 30);
  }

  @Get('collections/:id/changes')
  @RequireFeatureToggle(FeatureToggleKey.CONTEXT_LIBRARY, VIEW)
  @ApiOperation({ summary: 'What the learning loops changed, newest first' })
  changes(
    @Param('id') id: string,
    @Query('before') before?: string,
    @Query('limit') limit?: string,
  ) {
    return this.loopActions.list(
      id,
      limit ? Number(limit) || 50 : 50,
      before ? new Date(before) : undefined,
    );
  }

  @Post('changes/:actionId/undo')
  @RequireFeatureToggle(FeatureToggleKey.CONTEXT_LIBRARY, EDIT)
  @ApiOperation({
    summary: 'Undo a loop action; the loop will not repeat it on that entry',
  })
  undoChange(
    @Param('actionId', ParseUUIDPipe) actionId: string,
    @CurrentUser() user: TokenUser,
  ) {
    return this.loopActions.undo(actionId, user?.id ?? null);
  }

  @Post('gaps/:gapId/dismiss')
  @RequireFeatureToggle(FeatureToggleKey.CONTEXT_LIBRARY, EDIT)
  @ApiOperation({
    summary: 'Hide a missing topic; it will not be listed again',
  })
  async dismissGap(@Param('gapId', ParseUUIDPipe) gapId: string) {
    await this.gaps.dismiss(gapId);
    return { dismissed: true };
  }

  @Get('collections/:id/loops')
  @RequireFeatureToggle(FeatureToggleKey.CONTEXT_LIBRARY, VIEW)
  @ApiOperation({
    summary: "A collection's loop switches, judge sample rate and search setup",
  })
  loopSettings(@Param('id') id: string) {
    requireProfile(id);
    return this.loops.settings(id);
  }

  @Put('collections/:id/loops')
  @RequireFeatureToggle(FeatureToggleKey.CONTEXT_LIBRARY, EDIT)
  setLoopSettings(
    @Param('id') id: string,
    @Body() dto: ContextLoopSettingsDto,
  ) {
    requireProfile(id);
    return this.loops.updateSettings(id, dto);
  }

  @Post('collections/:id/loops/run')
  @RequireFeatureToggle(FeatureToggleKey.CONTEXT_LIBRARY, EDIT)
  @ApiOperation({
    summary:
      'Run the nightly loops (or tuning) for one collection now, in the background',
  })
  runLoops(@Param('id') id: string, @Query('kind') kind?: string) {
    requireProfile(id);
    const run =
      kind === 'tuning' ? this.loops.runTuning(id) : this.loops.runNightly(id);
    void run.catch(() => undefined);
    return { started: true, kind: kind === 'tuning' ? 'tuning' : 'nightly' };
  }

  // ── Retired Knowledge Base corpora (one-off, §6.5) ────────────────────────────

  @Get('migrations/character-library')
  @RequireFeatureToggle(FeatureToggleKey.CONTEXT_LIBRARY, EDIT)
  @ApiOperation({
    summary:
      'How far the character corpus has been distilled into Character Insights',
  })
  characterCorpusStatus() {
    return this.kbImport.status();
  }

  @Post('migrations/character-library/import')
  @RequireFeatureToggle(FeatureToggleKey.CONTEXT_LIBRARY, EDIT)
  @ApiOperation({
    summary: 'Distil the retired character corpus into Character Insights',
    description:
      'Platform admins only. Idempotent: documents already imported are skipped. Each old ' +
      'document becomes one source; its stored passages are staged in Redis (24h) and ' +
      'distilled by the worker. No document text is written to Postgres or S3.',
  })
  importCharacterCorpus(@CurrentUser() user: TokenUser) {
    return this.kbImport.import(actorFor(user));
  }

  @Get('migrations/character-library/smoke-check')
  @RequireFeatureToggle(FeatureToggleKey.CONTEXT_LIBRARY, EDIT)
  @ApiOperation(smokeDoc('character_interview', 'Character Insights'))
  characterSmokeCheck(@CurrentUser() user: TokenUser) {
    return this.kbCopy.smokeCheckDistilled(
      CHARACTER_CORPUS_MIGRATION,
      actorFor(user),
    );
  }

  @Post('migrations/character-library/retire')
  @RequireFeatureToggle(FeatureToggleKey.CONTEXT_LIBRARY, EDIT)
  @ApiOperation({
    summary: 'Delete the retired character corpus',
    description:
      'Platform admins only, and only once the import reports complete. Drops its Weaviate ' +
      'collection and deletes its documents, passages, stored files and retrieval logs. ' +
      'Requires { "confirm": "retire character_library" }.',
  })
  retireCharacterCorpus(
    @CurrentUser() user: TokenUser,
    @Body() dto: ContextRetireCorpusDto,
  ) {
    return this.kbImport.retire(dto.confirm, actorFor(user));
  }

  // The Ally guide's library and Debrief's guidance were copied word for word by migration
  // 1981000800000, so their routes have no import: a status, enrichment of the copies, the smoke
  // check, and retirement of the old corpus.

  @Get('migrations/ally-guide-library')
  @RequireFeatureToggle(FeatureToggleKey.CONTEXT_LIBRARY, EDIT)
  @ApiOperation({
    summary:
      "How far the Ally guide's library was copied into the Ally Guide Library",
  })
  allyGuideCorpusStatus() {
    return this.kbImport.status(ALLY_GUIDE_CORPUS_MIGRATION);
  }

  @Post('migrations/ally-guide-library/enrich')
  @RequireFeatureToggle(FeatureToggleKey.CONTEXT_LIBRARY, EDIT)
  @ApiOperation(enrichDoc('Ally Guide Library'))
  enrichAllyGuideCopies(@CurrentUser() user: TokenUser) {
    return this.kbCopy.startEnrichment(
      ALLY_GUIDE_CORPUS_MIGRATION,
      actorFor(user),
    );
  }

  @Get('migrations/ally-guide-library/smoke-check')
  @RequireFeatureToggle(FeatureToggleKey.CONTEXT_LIBRARY, EDIT)
  @ApiOperation(smokeDoc('ally_guide', 'Ally Guide Library'))
  allyGuideSmokeCheck(@CurrentUser() user: TokenUser) {
    return this.kbCopy.smokeCheck(ALLY_GUIDE_CORPUS_MIGRATION, actorFor(user));
  }

  @Post('migrations/ally-guide-library/retire')
  @RequireFeatureToggle(FeatureToggleKey.CONTEXT_LIBRARY, EDIT)
  @ApiOperation(retireDoc(ALLY_GUIDE_CORPUS_MIGRATION))
  retireAllyGuideCorpus(
    @CurrentUser() user: TokenUser,
    @Body() dto: ContextRetireCorpusDto,
  ) {
    return this.kbImport.retire(
      dto.confirm,
      actorFor(user),
      ALLY_GUIDE_CORPUS_MIGRATION,
    );
  }

  @Get('migrations/debrief-knowledge')
  @RequireFeatureToggle(FeatureToggleKey.CONTEXT_LIBRARY, EDIT)
  @ApiOperation({
    summary: "How far Debrief's guidance was copied into Debrief Guidance",
  })
  debriefCorpusStatus() {
    return this.kbImport.status(DEBRIEF_CORPUS_MIGRATION);
  }

  @Post('migrations/debrief-knowledge/enrich')
  @RequireFeatureToggle(FeatureToggleKey.CONTEXT_LIBRARY, EDIT)
  @ApiOperation(enrichDoc('Debrief Guidance'))
  enrichDebriefCopies(@CurrentUser() user: TokenUser) {
    return this.kbCopy.startEnrichment(
      DEBRIEF_CORPUS_MIGRATION,
      actorFor(user),
    );
  }

  @Get('migrations/debrief-knowledge/smoke-check')
  @RequireFeatureToggle(FeatureToggleKey.CONTEXT_LIBRARY, EDIT)
  @ApiOperation(smokeDoc('debrief', 'Debrief Guidance'))
  debriefSmokeCheck(@CurrentUser() user: TokenUser) {
    return this.kbCopy.smokeCheck(DEBRIEF_CORPUS_MIGRATION, actorFor(user));
  }

  @Post('migrations/debrief-knowledge/retire')
  @RequireFeatureToggle(FeatureToggleKey.CONTEXT_LIBRARY, EDIT)
  @ApiOperation(retireDoc(DEBRIEF_CORPUS_MIGRATION))
  retireDebriefCorpus(
    @CurrentUser() user: TokenUser,
    @Body() dto: ContextRetireCorpusDto,
  ) {
    return this.kbImport.retire(
      dto.confirm,
      actorFor(user),
      DEBRIEF_CORPUS_MIGRATION,
    );
  }

  // ── The automatic rollout after a release ─────────────────────────────────────

  @Get('rollout')
  @RequireFeatureToggle(FeatureToggleKey.CONTEXT_LIBRARY, VIEW)
  @ApiOperation({
    summary: 'Where the automatic post-release steps stand, per retired corpus',
    description:
      'Platform admins only, read-only. One entry per step (import or enrichment, smoke check, ' +
      'retirement) with its status, attempts, times and counts. The steps run by themselves ' +
      'unless CONTEXT_LIBRARY_AUTO_ROLLOUT=off; the migrations routes above still do each by hand.',
  })
  async rolloutStatus(@CurrentUser() user: TokenUser) {
    await this.kbImport.assertPlatformAdmin(actorFor(user));
    return this.rollout.view();
  }

  // ── Content Catalogue, synced from Studio (phase 7, §6.4) ─────────────────────

  @Get('migrations/content-catalogue')
  @RequireFeatureToggle(FeatureToggleKey.CONTEXT_LIBRARY, EDIT)
  @ApiOperation({
    summary:
      'Per kind: active Studio rows, synced items, and items waiting for enrichment',
  })
  async catalogueStatus(@CurrentUser() user: TokenUser) {
    await this.kbImport.assertPlatformAdmin(actorFor(user));
    return this.catalogue.status();
  }

  @Post('migrations/content-catalogue/sync')
  @RequireFeatureToggle(FeatureToggleKey.CONTEXT_LIBRARY, EDIT)
  @ApiOperation({
    summary:
      'Reconcile the Content Catalogue with Studio now, in the background',
    description:
      'Platform admins only. The same run as the nightly one: every active roleplay, case, ' +
      'character and component template gets its item, items whose row is gone or no longer ' +
      'active are archived, and items still waiting are enriched with example searches. Studio ' +
      'text is copied, never rewritten. A run already in progress on any server is not repeated.',
  })
  async syncCatalogue(@CurrentUser() user: TokenUser) {
    await this.kbImport.assertPlatformAdmin(actorFor(user));
    void this.catalogue.reconcile({ enrich: true }).catch(() => undefined);
    return { started: true };
  }
}

function enrichDoc(collection: string) {
  return {
    summary: `Enrich the passages imported into ${collection}, in the background`,
    description:
      'Platform admins only. Adds situations, example searches, keywords and missing facets, and ' +
      'a one-line statement in place of the citation heading; the passage text is never touched. ' +
      'Returns how many were pending; re-run to retry any that failed.',
  };
}

function smokeDoc(useCase: string, collection: string) {
  return {
    summary: `Replay the last 30 days of ${useCase} searches against ${collection}`,
    description:
      'Platform admins only, read-only. Each logged search (old corpus and new collection) is ' +
      "replayed as its asker's organisation; the report counts those with a good-or-better " +
      'result and groups the rest into missing topics. Counts and topic labels only: the ' +
      "searches are learners' own words and are never returned.",
  };
}

function retireDoc(migration: KbCorpusMigration) {
  return {
    summary: `Delete the retired ${migration.corpus} corpus`,
    description:
      'Platform admins only, and only once every passage has its copy. Drops its Weaviate ' +
      'collection and deletes its documents, passages, stored files and retrieval logs. ' +
      `Requires { "confirm": "${migration.confirmation}" }.`,
  };
}
