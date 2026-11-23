import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
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

import { Public } from 'src/auth/decorators/auth.metadata';
import { RequireFeatureToggle } from 'src/auth/decorators/feature-toggle.decorator';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { RateLimit } from 'src/rate-limit/decorator/rate-limit.decorator';

import { LANDING_PUBLIC_CACHE_SECONDS } from '../constants/landing-page.constants';
import {
  CreateLandingPageDto,
  GetLandingPagesQueryDto,
  GetLandingPagesResponseDto,
  LandingPageResponseDto,
  PublicLandingPageResponseDto,
  UpdateLandingPageDto,
  UploadLandingImageRequestDto,
  UploadLandingImageResponseDto,
} from '../dto/landing-page.dto';
import { LandingPageService } from '../service/landing-page.service';

/** Signed-out read of a published landing page, for the consumer app. */
@ApiTags('Landing pages')
@Controller('v1/public/landing-pages')
export class LandingPagePublicController {
  constructor(private readonly landingPageService: LandingPageService) {}

  @Public()
  @RateLimit({ key: 'ip', limit: 120, ttl: 60_000 })
  @Get(':tenantCode/:slug')
  @Header('Cache-Control', `public, max-age=${LANDING_PUBLIC_CACHE_SECONDS}`)
  @ApiOperation({ summary: 'A published landing page (public, no auth)' })
  @ApiResponse({ status: 200, type: PublicLandingPageResponseDto })
  @ApiResponse({ status: 404, description: 'No such published page' })
  getPublished(
    @Param('tenantCode') tenantCode: string,
    @Param('slug') slug: string,
  ): Promise<PublicLandingPageResponseDto> {
    return this.landingPageService.getPublished(tenantCode, slug);
  }
}

/** Platform admins manage landing pages here. Gated by the Landing pages toggle and a permission. */
@ApiTags('Landing pages')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('v1/landing-pages')
export class LandingPageController {
  constructor(private readonly landingPageService: LandingPageService) {}

  // Before ':id' so 'upload-url' is not read as an id.
  @Post('upload-url')
  @RequireFeatureToggle(FeatureToggleKey.LANDING_PAGES, {
    permissions: [PERMISSIONS.EDIT_LANDING_PAGE],
  })
  @ApiOperation({ summary: 'Presigned URL for a landing page image upload' })
  @ApiResponse({ status: 201, type: UploadLandingImageResponseDto })
  createImageUploadUrl(
    @Body() body: UploadLandingImageRequestDto,
  ): Promise<UploadLandingImageResponseDto> {
    return this.landingPageService.createImageUploadUrl(body);
  }

  @Post()
  @RequireFeatureToggle(FeatureToggleKey.LANDING_PAGES, {
    permissions: [PERMISSIONS.EDIT_LANDING_PAGE],
  })
  @ApiOperation({ summary: 'Create a landing page (as a draft)' })
  @ApiResponse({ status: 201, type: LandingPageResponseDto })
  create(@Body() body: CreateLandingPageDto): Promise<LandingPageResponseDto> {
    return this.landingPageService.create(body);
  }

  @Get()
  @RequireFeatureToggle(FeatureToggleKey.LANDING_PAGES, {
    permissions: [PERMISSIONS.VIEW_LANDING_PAGES],
  })
  @ApiOperation({ summary: 'List landing pages across organizations' })
  @ApiResponse({ status: 200, type: GetLandingPagesResponseDto })
  list(
    @Query() query: GetLandingPagesQueryDto,
  ): Promise<GetLandingPagesResponseDto> {
    return this.landingPageService.list(query);
  }

  @Get(':id')
  @RequireFeatureToggle(FeatureToggleKey.LANDING_PAGES, {
    permissions: [PERMISSIONS.VIEW_LANDING_PAGES],
  })
  @ApiOperation({ summary: 'A landing page with its draft configuration' })
  @ApiResponse({ status: 200, type: LandingPageResponseDto })
  getById(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<LandingPageResponseDto> {
    return this.landingPageService.getById(id);
  }

  @Get(':id/preview')
  @RequireFeatureToggle(FeatureToggleKey.LANDING_PAGES, {
    permissions: [PERMISSIONS.VIEW_LANDING_PAGES],
  })
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'The draft, shaped like the public response' })
  @ApiResponse({ status: 200, type: PublicLandingPageResponseDto })
  getPreview(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PublicLandingPageResponseDto> {
    return this.landingPageService.getPreview(id);
  }

  @Patch(':id')
  @RequireFeatureToggle(FeatureToggleKey.LANDING_PAGES, {
    permissions: [PERMISSIONS.EDIT_LANDING_PAGE],
  })
  @ApiOperation({ summary: 'Rename, re-address or replace the draft config' })
  @ApiResponse({ status: 200, type: LandingPageResponseDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateLandingPageDto,
  ): Promise<LandingPageResponseDto> {
    return this.landingPageService.update(id, body);
  }

  @Post(':id/publish')
  @HttpCode(200)
  @RequireFeatureToggle(FeatureToggleKey.LANDING_PAGES, {
    permissions: [PERMISSIONS.EDIT_LANDING_PAGE],
  })
  @ApiOperation({ summary: 'Make the current draft the live page' })
  @ApiResponse({ status: 200, type: LandingPageResponseDto })
  @ApiResponse({ status: 400, description: 'Lists what is missing' })
  publish(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<LandingPageResponseDto> {
    return this.landingPageService.publish(id);
  }

  @Post(':id/unpublish')
  @HttpCode(200)
  @RequireFeatureToggle(FeatureToggleKey.LANDING_PAGES, {
    permissions: [PERMISSIONS.EDIT_LANDING_PAGE],
  })
  @ApiOperation({ summary: 'Take the page down; the draft is kept' })
  @ApiResponse({ status: 200, type: LandingPageResponseDto })
  unpublish(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<LandingPageResponseDto> {
    return this.landingPageService.unpublish(id);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequireFeatureToggle(FeatureToggleKey.LANDING_PAGES, {
    permissions: [PERMISSIONS.DELETE_LANDING_PAGE],
  })
  @ApiOperation({ summary: 'Delete a landing page (soft delete)' })
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.landingPageService.remove(id);
  }
}
