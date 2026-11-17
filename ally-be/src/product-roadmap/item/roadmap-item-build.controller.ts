import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
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
import { RecordExternalBuildDto } from './roadmap-build.dto';
import {
  BuildBriefResponse,
  RoadmapItemBuildService,
} from './roadmap-item-build.service';
import type { ItemDetail } from './roadmap-item.types';

const VIEW = { permissions: [PERMISSIONS.VIEW_PRODUCT_ROADMAP] };

/**
 * Open in Claude Code (D18, §4.5b): the build brief and "Brief sent".
 * 404 while `roadmap_v2` is off; who may call them is decided in
 * RoadmapItemBuildService (the lead or an Owner, once Ready to build).
 */
@ApiTags('Roadmap v2')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller({ path: 'roadmap', version: '1' })
export class RoadmapItemBuildController {
  constructor(
    private readonly settings: PlanSettingsService,
    private readonly build: RoadmapItemBuildService,
  ) {}

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, VIEW)
  @Get('items/:code/brief')
  @ApiOperation({
    summary:
      'The build brief as markdown, from an allowlist: never strategy, ranking rationale, spend or the transcript',
  })
  async brief(
    @Param('code') code: string,
    @CurrentUser() user: TokenUser,
  ): Promise<BuildBriefResponse> {
    await this.settings.assertRoadmapV2();
    return this.build.brief(user.id, code);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, VIEW)
  @Post('items/:code/external-build')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Record "Brief sent to Claude Code": the idea is Building once a PR carrying its code exists',
  })
  async externalBuild(
    @Param('code') code: string,
    // Validated for its one allowed value; nothing else is read yet.
    @Body() _dto: RecordExternalBuildDto,
    @CurrentUser() user: TokenUser,
  ): Promise<ItemDetail> {
    await this.settings.assertRoadmapV2();
    return this.build.recordExternalBuild(user.id, code);
  }
}
