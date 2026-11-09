import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { InjectRepository } from '@nestjs/typeorm';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { Repository } from 'typeorm';
import { RequireFeatureToggle } from 'src/auth/decorators/feature-toggle.decorator';
import { OrgScopedRoute } from 'src/auth/decorators/org-scoped-route.decorator';
import { CurrentUser } from 'src/auth/decorators/user.decorator';
import { TokenUser } from 'src/auth/type/auth.types';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { TenantScopeService } from 'src/authorization/service/tenant-scope.service';
import { CL_BULK_MAX_BYTES } from '../constants/context-library.constants';
import {
  ContextAuthoredChunkDto,
  ContextBulkDto,
  ContextChunkListQueryDto,
  ContextSearchDto,
} from '../dto/context-library.dto';
import { ClChunkSource } from '../entity/cl-chunk-links.entity';
import { ClChunk } from '../entity/cl-chunk.entity';
import { ClCollection } from '../entity/cl-collection.entity';
import { ClSource } from '../entity/cl-source.entity';
import { ClChunkStatus, ClUseCase } from '../enum/context-library.enum';
import {
  COLLECTION_PROFILES,
  CollectionProfile,
  getProfile,
} from '../profiles';
import { ClActor, ContextChunkService } from '../service/context-chunk.service';
import { ContextLoopsService } from '../service/context-loops.service';
import { ContextRetrievalService } from '../service/context-retrieval.service';
import { templateCsv } from '../util/bulk.util';
import { chunkDetail, toAuthoredInput } from './context-library.controller';

// The gate the Ally guide library's organisation routes had, which these replace: the Ally
// organisation-settings toggle (org-scoped routes only, for an admin restricted to some
// organisations) with the Ally guide's view and edit permissions.
const VIEW = { permissions: [PERMISSIONS.VIEW_ALLY_GUIDE] };
const EDIT = { permissions: [PERMISSIONS.EDIT_ALLY_GUIDE] };

/** The collections an organisation writes to: today, the Ally Guide Library. */
export const ORG_COLLECTIONS = (): CollectionProfile[] =>
  Object.values(COLLECTION_PROFILES).filter((p): p is CollectionProfile =>
    Boolean(p?.allowsOrgChunks),
  );

/**
 * One organisation's view of the Context Library (PLAN.md §10.2), for its admins.
 *
 * The ROUTE decides the scope — `?tenantId=` names the organisation, checked against the admin's
 * allowlist by `@OrgScopedRoute` and again here — never a request body. Within it, an admin sees
 * only collections that take organisation entries; in those, their organisation's own entries
 * (which they may add, edit, archive and pin) and the global ones, read-only, so they can avoid
 * duplicating Ally's material. Never another organisation's, never Settings, documents or the
 * learning loops' changes, and Insights only for their own entries and their own learners' gaps.
 *
 * Replaces the Ally guide library's organisation routes (`v1/guide/admin/org-library/*`) and is
 * gated the same way: the `ally_guide_org` toggle with the Ally guide's view and edit permissions.
 */
@ApiTags('Context Library — organisation')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('v1/context-library/org')
export class ContextLibraryOrgController {
  constructor(
    private readonly chunkService: ContextChunkService,
    private readonly retrieval: ContextRetrievalService,
    private readonly loops: ContextLoopsService,
    private readonly tenantScope: TenantScopeService,
    @InjectRepository(ClCollection)
    private readonly collections: Repository<ClCollection>,
    @InjectRepository(ClSource) private readonly sources: Repository<ClSource>,
    @InjectRepository(ClChunkSource)
    private readonly chunkSources: Repository<ClChunkSource>,
  ) {}

  /** The organisation named by the route, re-checked here as well as by the guard. */
  private async actor(user: TokenUser, tenantId: string): Promise<ClActor> {
    await this.tenantScope.assertTenantInScope(tenantId, {
      userId: user?.id,
    });
    const [exists]: Array<{ id: string }> =
      await this.collections.manager.query(
        `SELECT id FROM tenants WHERE id = $1`,
        [tenantId],
      );
    if (!exists) throw new NotFoundException('No such organisation.');
    return { userId: user?.id ?? null, tenantId };
  }

  private orgCollection(collectionId: string): CollectionProfile {
    const profile = getProfile(collectionId);
    if (!profile?.allowsOrgChunks) {
      throw new NotFoundException(
        'That collection does not take organisation entries.',
      );
    }
    return profile;
  }

  /**
   * A chunk this organisation may see: in a collection that takes organisation entries, and
   * global or its own. Anything else is the same 404 as a missing code, so codes cannot be
   * probed.
   */
  private async visibleChunk(code: string, tenantId: string): Promise<ClChunk> {
    const chunk = await this.chunkService.findByCode(code);
    const profile = getProfile(chunk.collectionId);
    if (
      !profile?.allowsOrgChunks ||
      (!chunk.isGlobal && chunk.ownerTenantId !== tenantId)
    ) {
      throw new NotFoundException(`No chunk ${code}`);
    }
    return chunk;
  }

  // ── Collections ────────────────────────────────────────────────────────────

  @Get('collections')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE_ORG, VIEW)
  @OrgScopedRoute()
  @ApiOperation({
    summary:
      'Collections that take organisation entries, with counts of what this organisation sees',
  })
  async listCollections(
    @CurrentUser() user: TokenUser,
    @Query('tenantId', new ParseUUIDPipe()) tenantId: string,
  ) {
    await this.actor(user, tenantId);
    const profiles = ORG_COLLECTIONS();
    const rows = await this.collections.find();
    const counts: Array<{
      collection_id: string;
      status: string;
      n: string;
      own: string;
    }> = await this.collections.manager.query(
      `SELECT collection_id, status, COUNT(*) AS n,
              COUNT(*) FILTER (WHERE owner_tenant_id = $1) AS own
         FROM cl_chunks
        WHERE (is_global = true OR owner_tenant_id = $1)
        GROUP BY collection_id, status`,
      [tenantId],
    );
    return profiles
      .filter((p) => rows.some((r) => r.id === p.id))
      .map((profile) => {
        const mine = counts.filter((c) => c.collection_id === profile.id);
        return {
          id: profile.id,
          name: profile.name,
          noun: profile.noun,
          nounPlural: profile.nounPlural,
          codePrefix: profile.codePrefix,
          // Organisations write entries; documents and the loops stay platform-wide.
          allowedOrigins: profile.allowedOrigins,
          allowsOrgChunks: true,
          takesDocuments: false,
          facets: profile.facets,
          attributes: profile.attributes,
          statementMaxChars: profile.statementMaxChars,
          counts: Object.fromEntries(mine.map((c) => [c.status, Number(c.n)])),
          ownActive: Number(
            mine.find((c) => c.status === ClChunkStatus.ACTIVE)?.own ?? 0,
          ),
        };
      });
  }

  @Get('collections/:id/template.csv')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE_ORG, VIEW)
  @OrgScopedRoute()
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @ApiOperation({ summary: 'The bulk-upload template for one collection' })
  async template(
    @CurrentUser() user: TokenUser,
    @Param('id') id: string,
    @Query('tenantId', new ParseUUIDPipe()) tenantId: string,
  ) {
    await this.actor(user, tenantId);
    return templateCsv(this.orgCollection(id));
  }

  // ── Entries ────────────────────────────────────────────────────────────────

  @Get('chunks')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE_ORG, VIEW)
  @OrgScopedRoute()
  @ApiOperation({
    summary: "This organisation's entries and the global ones",
    description:
      '`audience=mine` for this organisation’s own entries only, `audience=global` for the ' +
      'global ones only; otherwise both.',
  })
  async listChunks(
    @CurrentUser() user: TokenUser,
    @Query('tenantId', new ParseUUIDPipe()) tenantId: string,
    @Query() dto: ContextChunkListQueryDto,
  ) {
    await this.actor(user, tenantId);
    const { audience, collectionId, ...rest } = dto;
    if (!collectionId) {
      throw new BadRequestException('Choose a collection.');
    }
    this.orgCollection(collectionId);
    if (audience && audience !== 'global' && audience !== 'mine') {
      throw new BadRequestException('audience must be "global" or "mine".');
    }
    return this.chunkService.list({
      ...rest,
      collectionId,
      ownerTenantId: tenantId,
      ...(audience === 'global' ? { globalOnly: true } : {}),
      ...(audience === 'mine' ? { ownedBy: tenantId } : {}),
    });
  }

  @Get('chunks/:code')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE_ORG, VIEW)
  @OrgScopedRoute()
  async getChunk(
    @CurrentUser() user: TokenUser,
    @Param('code') code: string,
    @Query('tenantId', new ParseUUIDPipe()) tenantId: string,
  ) {
    await this.actor(user, tenantId);
    const chunk = await this.visibleChunk(code, tenantId);
    return chunkDetail(chunk, this.chunkSources, this.sources);
  }

  @Post('collections/:id/chunks')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE_ORG, EDIT)
  @OrgScopedRoute()
  @ApiOperation({
    summary:
      "Write one of this organisation's entries. Only its own learners' guide reads it.",
  })
  async createChunk(
    @CurrentUser() user: TokenUser,
    @Param('id') collectionId: string,
    @Query('tenantId', new ParseUUIDPipe()) tenantId: string,
    @Body() dto: ContextAuthoredChunkDto,
  ) {
    const actor = await this.actor(user, tenantId);
    this.orgCollection(collectionId);
    return this.chunkService.createAuthored(
      collectionId,
      toAuthoredInput(dto),
      actor,
    );
  }

  @Patch('chunks/:code')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE_ORG, EDIT)
  @OrgScopedRoute()
  async updateChunk(
    @CurrentUser() user: TokenUser,
    @Param('code') code: string,
    @Query('tenantId', new ParseUUIDPipe()) tenantId: string,
    @Body() dto: ContextAuthoredChunkDto,
  ) {
    const actor = await this.actor(user, tenantId);
    await this.visibleChunk(code, tenantId);
    return this.chunkService.updateAuthored(code, toAuthoredInput(dto), actor);
  }

  @Post('chunks/:code/:action')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE_ORG, EDIT)
  @OrgScopedRoute()
  @ApiOperation({
    summary:
      'Archive, restore, pin or unpin one of this organisation’s entries',
  })
  async chunkAction(
    @CurrentUser() user: TokenUser,
    @Param('code') code: string,
    @Param('action') action: string,
    @Query('tenantId', new ParseUUIDPipe()) tenantId: string,
  ) {
    const actor = await this.actor(user, tenantId);
    const chunk = await this.visibleChunk(code, tenantId);
    // Global entries are read-only here; say so rather than pretending they are missing.
    if (chunk.ownerTenantId !== tenantId) {
      throw new ForbiddenException(
        'You can only change your own organisation’s entries.',
      );
    }
    switch (action) {
      case 'archive':
        return this.chunkService.setStatus(code, ClChunkStatus.ARCHIVED, actor);
      case 'restore':
        return this.chunkService.setStatus(code, ClChunkStatus.ACTIVE, actor);
      case 'pin':
        return this.chunkService.setPinned(code, true, actor);
      case 'unpin':
        return this.chunkService.setPinned(code, false, actor);
      default:
        throw new NotFoundException();
    }
  }

  @Post('bulk')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE_ORG, EDIT)
  @OrgScopedRoute()
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: CL_BULK_MAX_BYTES } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: "Bulk-upload this organisation's entries (CSV or JSON)",
    description:
      'A dry run by default: send apply="true" to write. Every entry is the organisation’s own; ' +
      'a row whose code names another organisation’s or a global entry is rejected.',
  })
  async bulk(
    @CurrentUser() user: TokenUser,
    @Query('tenantId', new ParseUUIDPipe()) tenantId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: ContextBulkDto,
  ) {
    const actor = await this.actor(user, tenantId);
    this.orgCollection(dto.collectionId);
    return this.chunkService.bulk(
      dto.collectionId,
      file?.originalname ?? 'upload',
      file?.buffer ?? Buffer.alloc(0),
      actor,
      dto.apply === 'true',
    );
  }

  // ── Search, as this organisation's learners would be served ──────────────

  @Post('search')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE_ORG, VIEW)
  @OrgScopedRoute()
  async search(
    @CurrentUser() user: TokenUser,
    @Query('tenantId', new ParseUUIDPipe()) tenantId: string,
    @Body() dto: ContextSearchDto,
  ) {
    await this.actor(user, tenantId);
    const collections = dto.collectionId
      ? [this.orgCollection(dto.collectionId).id]
      : ORG_COLLECTIONS().map((p) => p.id);
    const response = await this.retrieval.search({
      useCase: ClUseCase.ADMIN_PREVIEW,
      audience: { tenantId },
      queries: [dto.query],
      collections,
      limit: dto.limit ?? 20,
      fast: !dto.rerank,
      queryOrigin: 'human',
    });
    return {
      results: response.results.map((r) => ({
        chunk: r.chunk,
        band: r.band,
        score: r.score,
      })),
      noConfidentMatch: response.noConfidentMatch,
    };
  }

  // ── Insights for this organisation's entries ─────────────────────────────

  @Get('collections/:id/insights')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE_ORG, VIEW)
  @OrgScopedRoute()
  @ApiOperation({
    summary:
      "Is it helping (this organisation's entries), what its learners searched for and missed, and its never-useful entries",
  })
  async insights(
    @CurrentUser() user: TokenUser,
    @Param('id') id: string,
    @Query('tenantId', new ParseUUIDPipe()) tenantId: string,
    @Query('days') days?: string,
  ) {
    await this.actor(user, tenantId);
    this.orgCollection(id);
    return this.loops.insights(id, days ? Number(days) || 30 : 30, {
      tenantId,
    });
  }
}
