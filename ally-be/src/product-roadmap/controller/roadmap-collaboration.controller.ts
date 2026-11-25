import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { RequireFeatureToggle } from 'src/auth/decorators/feature-toggle.decorator';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { CurrentUser } from 'src/auth/decorators/user.decorator';
import { TokenUser } from 'src/auth/type/auth.types';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';

import {
  CreateSavedViewDto,
  UpdateSavedViewDto,
} from '../dto/roadmap-content.dto';
import { RoadmapSavedViewService } from '../service/roadmap-saved-view.service';
import { RoadmapAccessService } from '../service/roadmap-access.service';

/** Saved views — the Roadmap queue's per-user filter tabs. */
@ApiTags('Product Roadmap')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller({ path: 'product-roadmap', version: '1' })
export class RoadmapCollaborationController {
  constructor(
    private readonly savedViewService: RoadmapSavedViewService,
    private readonly access: RoadmapAccessService,
  ) {}

  // ── saved views ───────────────────────────────────────────────────────────

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, {
    permissions: [PERMISSIONS.VIEW_PRODUCT_ROADMAP],
  })
  @Get('views')
  @ApiOperation({
    summary: 'Your saved views plus every pinned view',
    description:
      'The own-or-pinned row filter is applied in SQL. It replaces the source’s RLS policy and ' +
      'is the only rule here with no decorator equivalent.',
  })
  listViews(@CurrentUser() user: TokenUser) {
    return this.savedViewService.list(user.id);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, {
    permissions: [PERMISSIONS.VIEW_PRODUCT_ROADMAP],
  })
  @Get('views/tab-order')
  @ApiOperation({ summary: 'Your saved-view tab order' })
  getTabOrder(@CurrentUser() user: TokenUser) {
    return this.savedViewService.getTabOrder(user.id);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, {
    permissions: [PERMISSIONS.VOTE_PRODUCT_ROADMAP],
  })
  @Post('views')
  @ApiOperation({ summary: 'Save the current filters as a named view' })
  createView(@CurrentUser() user: TokenUser, @Body() dto: CreateSavedViewDto) {
    return this.savedViewService.create(user.id, dto);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, {
    permissions: [PERMISSIONS.VOTE_PRODUCT_ROADMAP],
  })
  @Patch('views/:id')
  @ApiOperation({
    summary: 'Rename or re-snapshot a view (owner or manager)',
    description:
      'Rejects `pinned`: pinning a view for everyone is not offered on this route.',
  })
  async updateView(
    @CurrentUser() user: TokenUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSavedViewDto,
  ) {
    return this.savedViewService.update(
      user.id,
      id,
      dto,
      await this.access.canManage(user.id),
    );
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, {
    permissions: [PERMISSIONS.VOTE_PRODUCT_ROADMAP],
  })
  @Delete('views/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a view (owner or manager)' })
  async removeView(
    @CurrentUser() user: TokenUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.savedViewService.remove(
      user.id,
      id,
      await this.access.canManage(user.id),
    );
  }
}
