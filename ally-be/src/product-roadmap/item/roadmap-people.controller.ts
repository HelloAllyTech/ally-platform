import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
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
import { PlanSettingsService } from 'src/product-planning/service/plan-settings.service';
import {
  RoadmapPreferenceService,
  RoadmapPreferences,
} from 'src/product-planning/service/roadmap-preference.service';
import {
  SetRoadmapPreferencesDto,
  SetRoadmapRoleDto,
} from './roadmap-build.dto';
import {
  RoadmapRoleAdminService,
  RoadmapRoleEntry,
} from './roadmap-role-admin.service';

const VIEW = { permissions: [PERMISSIONS.VIEW_PRODUCT_ROADMAP] };

/**
 * People on the Roadmap (§3.2, §5.7b): the Owner's role radio and each
 * person's own preferences. 404 while `roadmap_v2` is off.
 */
@ApiTags('Roadmap v2')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller({ path: 'roadmap', version: '1' })
export class RoadmapPeopleController {
  constructor(
    private readonly settings: PlanSettingsService,
    private readonly roleAdmin: RoadmapRoleAdminService,
    private readonly preferences: RoadmapPreferenceService,
  ) {}

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, VIEW)
  @Get('roles')
  @ApiOperation({
    summary: 'Owner: every platform admin and their Roadmap role',
  })
  async listRoles(
    @CurrentUser() user: TokenUser,
  ): Promise<{ users: RoadmapRoleEntry[] }> {
    await this.settings.assertRoadmapV2();
    return this.roleAdmin.list(user.id);
  }

  // `roles/preview` (RoadmapItemController) is registered first, so it is never read as a user id.
  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, VIEW)
  @Get('roles/:userId')
  @ApiOperation({ summary: "Owner: one platform admin's Roadmap role" })
  async getRole(
    @Param('userId', ParseIntPipe) userId: number,
    @CurrentUser() user: TokenUser,
  ): Promise<RoadmapRoleEntry> {
    await this.settings.assertRoadmapV2();
    return this.roleAdmin.get(user.id, userId);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, VIEW)
  @Put('roles/:userId')
  @ApiOperation({
    summary:
      'Owner: set a Roadmap role (none, idea, builder, owner); writes the three toggles together',
  })
  async setRole(
    @Param('userId', ParseIntPipe) userId: number,
    @Body() dto: SetRoadmapRoleDto,
    @CurrentUser() user: TokenUser,
  ): Promise<RoadmapRoleEntry> {
    await this.settings.assertRoadmapV2();
    return this.roleAdmin.set(user.id, userId, dto.role);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, VIEW)
  @Get('me/preferences')
  @ApiOperation({ summary: "The caller's Roadmap preferences (weekly digest)" })
  async myPreferences(
    @CurrentUser() user: TokenUser,
  ): Promise<RoadmapPreferences> {
    await this.settings.assertRoadmapV2();
    return this.preferences.get(user.id);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, VIEW)
  @Put('me/preferences')
  @ApiOperation({
    summary: 'Turn the weekly "Your ideas this week" email on or off',
  })
  async setMyPreferences(
    @Body() dto: SetRoadmapPreferencesDto,
    @CurrentUser() user: TokenUser,
  ): Promise<RoadmapPreferences> {
    await this.settings.assertRoadmapV2();
    return this.preferences.set(user.id, dto);
  }
}
