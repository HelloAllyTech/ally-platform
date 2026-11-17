import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
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
import { PlanCeilingService } from 'src/product-planning/service/plan-ceiling.service';
import { PlanSettingsService } from 'src/product-planning/service/plan-settings.service';
import { RoadmapInboxService } from 'src/product-planning/service/roadmap-inbox.service';
import { RoadmapRoleService } from 'src/product-planning/service/roadmap-role.service';
import {
  globalCapabilities,
  roleAtLeast,
} from 'src/product-planning/util/roadmap-role.util';
import {
  MarkRoadmapNotificationsReadDto,
  SetRoadmapCeilingDto,
  SetRoadmapWatchDto,
} from './roadmap-item.dto';
import { RoadmapItemLookupService } from './roadmap-item-lookup.service';

const VIEW = { permissions: [PERMISSIONS.VIEW_PRODUCT_ROADMAP] };

/**
 * Roadmap v2's own routes (plans/roadmap-builder-merge §5.2), P0's slice:
 * the caller's role, the cutover preview, the ceiling, the inbox and watch
 * levels. Every handler answers 404 first while `roadmap_v2` is off.
 *
 * The board's toggle is the route gate, like every roadmap route; who may do
 * what is decided inside the services by RoadmapRoleService.
 */
@ApiTags('Roadmap v2')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller({ path: 'roadmap', version: '1' })
export class RoadmapItemController {
  constructor(
    private readonly settings: PlanSettingsService,
    private readonly roles: RoadmapRoleService,
    private readonly ceiling: PlanCeilingService,
    private readonly inbox: RoadmapInboxService,
    private readonly items: RoadmapItemLookupService,
  ) {}

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, VIEW)
  @Get('me/role')
  @ApiOperation({ summary: "The caller's Roadmap role and what it allows" })
  async myRole(@CurrentUser() user: TokenUser) {
    await this.settings.assertRoadmapV2();
    const role = await this.roles.roleOf(user.id);
    return { role, can: globalCapabilities(role) };
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, VIEW)
  @Get('roles/preview')
  @ApiOperation({
    summary:
      'Owner only: who becomes Builder and Owner at cutover (names and ids)',
  })
  async previewRoles(@CurrentUser() user: TokenUser) {
    await this.settings.assertRoadmapV2();
    if ((await this.roles.roleOf(user.id)) !== 'owner') {
      throw new ForbiddenException('Only an Owner can see this list.');
    }
    return this.roles.previewPromotions();
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, VIEW)
  @Post('items/:code/ceiling')
  @ApiOperation({
    summary:
      "Raise an idea's spend ceiling: its lead up to the Owner-set maximum, an Owner any amount",
  })
  async setCeiling(
    @Param('code') code: string,
    @Body() dto: SetRoadmapCeilingDto,
    @CurrentUser() user: TokenUser,
  ) {
    await this.settings.assertRoadmapV2();
    const item = await this.items.get(code);
    if (!item.builderSessionId) {
      throw new NotFoundException(
        'This idea has no plan yet, so it has no ceiling to raise.',
      );
    }
    return this.ceiling.setCeiling(
      item.builderSessionId,
      user.id,
      dto.ceilingUsd,
    );
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, VIEW)
  @Get('notifications')
  @ApiOperation({ summary: "The caller's inbox, one line per group" })
  async notifications(@CurrentUser() user: TokenUser) {
    await this.settings.assertRoadmapV2();
    return this.inbox.listGrouped(user.id);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, VIEW)
  @Post('notifications/read')
  @ApiOperation({ summary: 'Mark notices read: by id, by group, or all' })
  async markRead(
    @CurrentUser() user: TokenUser,
    @Body() dto: MarkRoadmapNotificationsReadDto,
  ) {
    await this.settings.assertRoadmapV2();
    return { updated: await this.inbox.markRead(user.id, dto) };
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, VIEW)
  @Put('items/:code/watch')
  @ApiOperation({ summary: 'Watch an idea: all, milestones or none' })
  async watch(
    @Param('code') code: string,
    @Body() dto: SetRoadmapWatchDto,
    @CurrentUser() user: TokenUser,
  ) {
    await this.settings.assertRoadmapV2();
    if (!roleAtLeast(await this.roles.roleOf(user.id), 'idea')) {
      throw new ForbiddenException(
        'Watching ideas needs the Idea role on the Roadmap.',
      );
    }
    const item = await this.items.get(code);
    return this.inbox.setWatch(user.id, item.id, dto.level);
  }
}
