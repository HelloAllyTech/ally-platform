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
  ContextAuthoredChunkDto,
  ContextBulkDto,
  ContextChunkListQueryDto,
  ContextGrantDto,
  ContextResumeDto,
  ContextSearchDto,
  ContextUploadDto,
} from '../dto/context-library.dto';
import { ClChunkSource } from '../entity/cl-chunk-links.entity';
import { ClCollection } from '../entity/cl-collection.entity';
import { ClSource } from '../entity/cl-source.entity';
import { ClChunkStatus, ClUseCase } from '../enum/context-library.enum';
import { COLLECTION_PROFILES, requireProfile } from '../profiles';
import { templateCsv } from '../util/bulk.util';
import { ContextAccessService } from '../service/context-access.service';
import { ClActor, ContextChunkService } from '../service/context-chunk.service';
import { ContextRetrievalService } from '../service/context-retrieval.service';
import { ContextUploadService } from '../service/context-upload.service';

const VIEW = { permissions: [PERMISSIONS.VIEW_CONTEXT_LIBRARY] };
const EDIT = { permissions: [PERMISSIONS.EDIT_CONTEXT_LIBRARY] };

/** Platform admins act for the platform; organisation-scoped access arrives with phase 6. */
function actorFor(user: TokenUser): ClActor {
  return { userId: user?.id ?? null, tenantId: null };
}

function toAuthoredInput(dto: ContextAuthoredChunkDto) {
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
  listChunks(@Query() dto: ContextChunkListQueryDto) {
    return this.chunkService.list(dto);
  }

  @Get('chunks/:code')
  @RequireFeatureToggle(FeatureToggleKey.CONTEXT_LIBRARY, VIEW)
  async getChunk(@Param('code') code: string) {
    const chunk = await this.chunkService.findByCode(code);
    const links = await this.chunkSources.find({
      where: { chunkId: chunk.id },
    });
    const sources = links.length
      ? await this.sources.find({
          where: { id: In(links.map((l) => l.sourceId)) },
          select: ['id', 'title', 'docVersion', 'year'],
        })
      : [];
    return {
      ...chunk,
      sources: links.map((l) => ({
        ...sources.find((s) => s.id === l.sourceId),
        sectionPath: l.sectionPath,
        pageFrom: l.pageFrom,
        pageTo: l.pageTo,
      })),
    };
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
}
