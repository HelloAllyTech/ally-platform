import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { RequireFeatureToggle } from 'src/auth/decorators/feature-toggle.decorator';
import { OrgScopedRoute } from 'src/auth/decorators/org-scoped-route.decorator';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import {
  CreateKbOwnedDocumentDto,
  CreateKbUploadUrlDto,
  GetKbDocumentsResponseDto,
  GetKbOwnedDocumentsQueryDto,
  KbDocumentResponseDto,
  KbUploadUrlResponseDto,
} from 'src/knowledge-base/dto/knowledge-base.dto';
import { KnowledgeBaseService } from 'src/knowledge-base/service/knowledge-base.service';
import {
  PLATFORM_LIBRARY,
  organisationLibrary,
} from '../knowledge/guide-library.service';

const VIEW = { permissions: [PERMISSIONS.VIEW_ALLY_GUIDE] };
const EDIT = { permissions: [PERMISSIONS.EDIT_ALLY_GUIDE] };

/**
 * Ally's library, for the Ally Console (plans/ally-guide/plan.md §7.6, §10.5). Same prefix
 * and toggles as GuideAdminController; its own class so the library's routes live together.
 *
 * Two libraries, two scopes, and the ROUTE decides which — never the body:
 *  - `library/*` is the platform's: global documents every learner and visitor may read.
 *    `ally_guide` toggle.
 *  - `org-library/*` is one organisation's own protocols and handbooks, read only by its
 *    learners. `ally_guide_org` toggle, @OrgScopedRoute, so an admin restricted to some
 *    organisations reaches only theirs.
 *
 * Each scope lists, adds and removes its own documents only: the platform route never
 * touches an organisation's document, and an organisation's never touches another's or the
 * platform's — anything outside the scope is the same 404 as a missing id. Removing is an
 * archive: retrieval stops at once and the rows stay, so citations already recorded resolve.
 *
 * Uploads are two steps, as on the knowledge-base console: ask for an upload URL, PUT the
 * file to it, then create the document with the returned fileUrl. A fileUrl not issued for
 * this scope's folder is refused.
 */
@ApiTags('Ally guide — admin')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('v1/guide/admin')
export class GuideLibraryAdminController {
  constructor(private readonly knowledgeBase: KnowledgeBaseService) {}

  // ── Platform library ──────────────────────────────────────────────────────

  @Get('library/documents')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE, VIEW)
  @ApiOperation({
    summary:
      "The platform library: Ally's global documents, with ingest status",
  })
  @ApiResponse({ status: 200, type: GetKbDocumentsResponseDto })
  listPlatform(@Query() dto: GetKbOwnedDocumentsQueryDto) {
    return this.knowledgeBase.listOwned(PLATFORM_LIBRARY, dto);
  }

  @Post('library/documents/upload-url')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE, EDIT)
  @ApiOperation({
    summary: 'Presigned S3 PUT for a platform library file (pdf/docx/epub)',
  })
  @ApiResponse({ status: 201, type: KbUploadUrlResponseDto })
  platformUploadUrl(@Body() dto: CreateKbUploadUrlDto) {
    return this.knowledgeBase.createOwnedUploadUrl(PLATFORM_LIBRARY, dto);
  }

  @Post('library/documents')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE, EDIT)
  @ApiOperation({
    summary:
      'Add a global document to the library and queue it for indexing (returns at pending)',
  })
  @ApiResponse({ status: 201, type: KbDocumentResponseDto })
  createPlatform(@Body() dto: CreateKbOwnedDocumentDto) {
    return this.knowledgeBase.createOwned(PLATFORM_LIBRARY, dto);
  }

  @Delete('library/documents/:id')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE, EDIT)
  @ApiOperation({
    summary:
      'Remove a platform document: Ally stops using it at once; its rows stay for citations',
  })
  @ApiResponse({ status: 200, type: KbDocumentResponseDto })
  @ApiResponse({ status: 404, description: 'Not a platform library document' })
  removePlatform(@Param('id', ParseUUIDPipe) id: string) {
    return this.knowledgeBase.archiveOwned(PLATFORM_LIBRARY, id);
  }

  // ── One organisation's own documents ──────────────────────────────────────

  @Get('org-library/documents')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE_ORG, VIEW)
  @OrgScopedRoute()
  @ApiOperation({
    summary:
      "An organisation's own documents for Ally (protocols, handbooks), with ingest status",
  })
  @ApiResponse({ status: 200, type: GetKbDocumentsResponseDto })
  listOrg(
    @Query('tenantId', new ParseUUIDPipe()) tenantId: string,
    @Query() dto: GetKbOwnedDocumentsQueryDto,
  ) {
    return this.knowledgeBase.listOwned(organisationLibrary(tenantId), dto);
  }

  @Post('org-library/documents/upload-url')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE_ORG, EDIT)
  @OrgScopedRoute()
  @ApiOperation({
    summary: "Presigned S3 PUT for an organisation's document (pdf/docx/epub)",
  })
  @ApiResponse({ status: 201, type: KbUploadUrlResponseDto })
  orgUploadUrl(
    @Query('tenantId', new ParseUUIDPipe()) tenantId: string,
    @Body() dto: CreateKbUploadUrlDto,
  ) {
    return this.knowledgeBase.createOwnedUploadUrl(
      organisationLibrary(tenantId),
      dto,
    );
  }

  @Post('org-library/documents')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE_ORG, EDIT)
  @OrgScopedRoute()
  @ApiOperation({
    summary:
      "Add an organisation's own document (pasted or uploaded; no URL import). Only its learners' Ally reads it",
  })
  @ApiResponse({ status: 201, type: KbDocumentResponseDto })
  createOrg(
    @Query('tenantId', new ParseUUIDPipe()) tenantId: string,
    @Body() dto: CreateKbOwnedDocumentDto,
  ) {
    return this.knowledgeBase.createOwned(organisationLibrary(tenantId), dto);
  }

  @Delete('org-library/documents/:id')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE_ORG, EDIT)
  @OrgScopedRoute()
  @ApiOperation({
    summary:
      "Remove one of this organisation's documents: Ally stops using it at once; its rows stay for citations",
  })
  @ApiResponse({ status: 200, type: KbDocumentResponseDto })
  @ApiResponse({
    status: 404,
    description: "Not one of this organisation's documents",
  })
  removeOrg(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('tenantId', new ParseUUIDPipe()) tenantId: string,
  ) {
    return this.knowledgeBase.archiveOwned(organisationLibrary(tenantId), id);
  }
}
