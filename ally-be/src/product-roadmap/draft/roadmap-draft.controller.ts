import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { RequireFeatureToggle } from 'src/auth/decorators/feature-toggle.decorator';
import { CurrentUser } from 'src/auth/decorators/user.decorator';
import { TokenUser } from 'src/auth/type/auth.types';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { PlanSettingsService } from 'src/product-planning/service/plan-settings.service';
import {
  CreateRoadmapDraftDto,
  PatchRoadmapDraftDto,
  RoadmapDictationDto,
  RoadmapDraftTurnDto,
  SubmitRoadmapDraftDto,
} from './roadmap-draft.dto';
import { RoadmapDraftService } from './roadmap-draft.service';
import {
  DICTATION_MAX_BYTES,
  RoadmapDictationService,
} from './roadmap-dictation.service';

const VIEW = { permissions: [PERMISSIONS.VIEW_PRODUCT_ROADMAP] };

/**
 * Roadmap v2 P3: New idea, My drafts, the draft page and dictation
 * (plans/roadmap-builder-merge §4.2, §4.4, §4.13, D3, D9). Every handler
 * answers 404 first while `roadmap_v2` is off; roles are checked inside the
 * services. Contract: plans/roadmap-v2-build/P2-contract.md, "P3 routes".
 */
@ApiTags('Roadmap v2')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller({ path: 'roadmap', version: '1' })
export class RoadmapDraftController {
  constructor(
    private readonly settings: PlanSettingsService,
    private readonly drafts: RoadmapDraftService,
    private readonly dictation: RoadmapDictationService,
  ) {}

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, VIEW)
  @Post('drafts')
  @ApiOperation({ summary: 'New idea: a private draft and its code, no AI' })
  async create(
    @CurrentUser() user: TokenUser,
    @Body() dto: CreateRoadmapDraftDto,
  ) {
    await this.settings.assertRoadmapV2();
    return this.drafts.create(user.id, dto);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, VIEW)
  @Get('drafts')
  @ApiOperation({ summary: 'My drafts, newest first' })
  async list(
    @CurrentUser() user: TokenUser,
    @Query('archived') archived?: string,
  ) {
    await this.settings.assertRoadmapV2();
    return { drafts: await this.drafts.list(user.id, archived === '1') };
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, VIEW)
  @Get('drafts/:code')
  @ApiOperation({ summary: 'One of your drafts, for the draft page' })
  async detail(@Param('code') code: string, @CurrentUser() user: TokenUser) {
    await this.settings.assertRoadmapV2();
    return this.drafts.detail(user.id, code);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, VIEW)
  @Patch('drafts/:code')
  @ApiOperation({
    summary: 'Autosave: text and goal (stale baseVersion -> 409)',
  })
  async patch(
    @Param('code') code: string,
    @Body() dto: PatchRoadmapDraftDto,
    @CurrentUser() user: TokenUser,
  ) {
    await this.settings.assertRoadmapV2();
    return this.drafts.patch(user.id, code, dto);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, VIEW)
  @Delete('drafts/:code')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Discard a draft' })
  async discard(@Param('code') code: string, @CurrentUser() user: TokenUser) {
    await this.settings.assertRoadmapV2();
    await this.drafts.discard(user.id, code);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, VIEW)
  @Post('drafts/:code/restore')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Restore an archived draft' })
  async restore(@Param('code') code: string, @CurrentUser() user: TokenUser) {
    await this.settings.assertRoadmapV2();
    return this.drafts.restore(user.id, code);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, VIEW)
  @Post('drafts/:code/turn')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Check my idea (no answer) or reply to the idea agent; checks come back with quoted evidence',
  })
  async turn(
    @Param('code') code: string,
    @Body() dto: RoadmapDraftTurnDto,
    @CurrentUser() user: TokenUser,
  ) {
    await this.settings.assertRoadmapV2();
    return this.drafts.turn(user.id, code, dto);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, VIEW)
  @Post('drafts/:code/checks/:checkId/reopen')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Not quite: reopen one check' })
  async reopen(
    @Param('code') code: string,
    @Param('checkId') checkId: string,
    @CurrentUser() user: TokenUser,
  ) {
    await this.settings.assertRoadmapV2();
    return this.drafts.reopenCheck(user.id, code, checkId);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, VIEW)
  @Put('drafts/:code/self-check')
  @ApiOperation({
    summary:
      'Removed: answers 410. Drafts are finished by the interview (lifecycle 2026-11-18)',
  })
  async selfCheck() {
    await this.settings.assertRoadmapV2();
    return this.drafts.selfCheck();
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, VIEW)
  @Get('drafts/:code/similar')
  @ApiOperation({
    summary: 'At most two similar ideas (existing duplicate detection)',
  })
  async similar(@Param('code') code: string, @CurrentUser() user: TokenUser) {
    await this.settings.assertRoadmapV2();
    return this.drafts.similar(user.id, code);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, VIEW)
  @Post('drafts/:code/add-to/:targetCode')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Add my point to OPP-x: vote, comment there, archive this draft',
  })
  async addTo(
    @Param('code') code: string,
    @Param('targetCode') targetCode: string,
    @CurrentUser() user: TokenUser,
  ) {
    await this.settings.assertRoadmapV2();
    return this.drafts.addTo(user.id, code, targetCode);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, VIEW)
  @Post('drafts/:code/submit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Submit at 5 of 5: Submitted, shared, Owners told; keeps its code',
  })
  async submit(
    @Param('code') code: string,
    @Body() dto: SubmitRoadmapDraftDto,
    @CurrentUser() user: TokenUser,
  ) {
    await this.settings.assertRoadmapV2();
    return this.drafts.submit(user.id, code, dto);
  }

  /** D9. Memory storage: the clip is a buffer for this request only, never stored. */
  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, VIEW)
  @Post('dictation')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('audio', { limits: { fileSize: DICTATION_MAX_BYTES } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary:
      'Dictation: one clip (max 2 minutes) to editable text. Audio is never stored.',
  })
  async dictate(
    @CurrentUser() user: TokenUser,
    @UploadedFile() audio: Express.Multer.File,
    @Body() dto: RoadmapDictationDto,
  ) {
    await this.settings.assertRoadmapV2();
    return this.dictation.dictate(user.id, {
      audio,
      durationMs: dto.durationMs,
      code: dto.code,
    });
  }
}
