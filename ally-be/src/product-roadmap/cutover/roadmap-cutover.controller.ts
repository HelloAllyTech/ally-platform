import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
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
import { RunRoadmapCutoverDto } from './roadmap-cutover.dto';
import {
  CutoverPreview,
  CutoverResult,
  RoadmapCutoverService,
} from './roadmap-cutover.service';

/** The Owner's own toggle and permission: what RoadmapRoleService reads as Owner. */
const MANAGE = { permissions: [PERMISSIONS.EDIT_PRODUCT_ROADMAP] };

/**
 * Switch on Roadmap (Roadmap v2 P6). Unlike every other `/v1/roadmap/*` route these answer
 * while `roadmap_v2` is OFF — switching it on is what they are for. The route gate is the
 * Manage toggle; the service then requires the Roadmap Owner role, the same check the
 * `roadmapV2Enabled` PATCH on Builder settings makes. Switching off stays that PATCH.
 */
@ApiTags('Roadmap v2')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller({ path: 'roadmap/cutover', version: '1' })
export class RoadmapCutoverController {
  constructor(private readonly cutover: RoadmapCutoverService) {}

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP_MANAGE, MANAGE)
  @Get('preview')
  @ApiOperation({
    summary:
      'Owner only, flag on or off: who becomes Builder and Owner, and what the switch-on moves',
  })
  preview(@CurrentUser() user: TokenUser): Promise<CutoverPreview> {
    return this.cutover.preview(user.id);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP_MANAGE, MANAGE)
  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Owner only: move drafts and live direct sessions, accept unreviewed ideas, then switch Roadmap on. 409 if the confirmed lists are out of date. Idempotent.',
  })
  run(
    @Body() dto: RunRoadmapCutoverDto,
    @CurrentUser() user: TokenUser,
  ): Promise<CutoverResult> {
    return this.cutover.run(user.id, dto);
  }
}
