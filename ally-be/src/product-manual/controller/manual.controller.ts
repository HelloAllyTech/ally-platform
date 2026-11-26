import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
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
import { RoadmapRoleService } from 'src/product-planning/service/roadmap-role.service';
import { roleAtLeast } from 'src/product-planning/util/roadmap-role.util';
import {
  MANUAL_CHANGES_DEFAULT_LIMIT,
  MANUAL_CHANGES_MAX_LIMIT,
  MANUAL_SEARCH_DEFAULT_LIMIT,
  MANUAL_SEARCH_MAX_LIMIT,
} from '../constants/manual.constants';
import { RevertPageDto } from '../dto/manual.dto';
import { ManualChangesService } from '../service/manual-changes.service';
import { ManualGraphService } from '../service/manual-graph.service';
import { ManualPageService, toPageRow } from '../service/manual-page.service';
import { ManualSearchService } from '../service/manual-search.service';
import { ManualStateService } from '../service/manual-state.service';
import type {
  ChangeRow,
  ManualGraph,
  ManualState,
  PageDetail,
  PageRow,
  SearchHit,
} from '../type/manual.types';
import { manualErrorToHttp, parseLimit } from '../util/manual-http.util';
import { isValidSlug } from '../util/manual-slug.util';

const VIEW = { permissions: [PERMISSIONS.VIEW_PRODUCT_ROADMAP] };

/**
 * The Product Manual's reader (docs/product-manual.md): the tree, a page, search, the map, the change
 * log, revert and the tab's state. Every handler is behind the Product Manual toggle and answers 404
 * while Roadmap v2 is off; a caller with no roadmap role gets 403, and a revert needs the Idea role.
 */
@ApiTags('Product Manual')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller({ path: 'product-manual', version: '1' })
export class ManualController {
  constructor(
    private readonly settings: PlanSettingsService,
    private readonly roles: RoadmapRoleService,
    private readonly pages: ManualPageService,
    private readonly search: ManualSearchService,
    private readonly graph: ManualGraphService,
    private readonly changes: ManualChangesService,
    private readonly stateService: ManualStateService,
  ) {}

  /** Roadmap v2 on, and the caller holds a roadmap role (Idea or above when `write`). */
  private async gate(userId: number, write = false): Promise<void> {
    await this.settings.assertRoadmapV2();
    const role = await this.roles.roleOf(userId);
    if (role === 'none') {
      throw new ForbiddenException('You do not have access to the Roadmap.');
    }
    if (write && !roleAtLeast(role, 'idea')) {
      throw new ForbiddenException('Your access to the Roadmap is read-only.');
    }
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_MANUAL, VIEW)
  @Get('tree')
  @ApiOperation({
    summary: 'Every page and section, for the table of contents',
  })
  async tree(@CurrentUser() user: TokenUser): Promise<{ pages: PageRow[] }> {
    await this.gate(user.id);
    return { pages: (await this.pages.list()).map(toPageRow) };
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_MANUAL, VIEW)
  @Get('pages/:slug')
  @ApiOperation({
    summary: 'One page with links, breadcrumb, children and last change',
  })
  async page(
    @Param('slug') slug: string,
    @CurrentUser() user: TokenUser,
  ): Promise<PageDetail> {
    await this.gate(user.id);
    const detail = isValidSlug(slug) ? await this.pages.detail(slug) : null;
    if (!detail) throw new NotFoundException('No such page.');
    return detail;
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_MANUAL, VIEW)
  @Get('search')
  @ApiOperation({
    summary: 'Full-text search; fewer than 2 characters returns nothing',
  })
  async find(
    @CurrentUser() user: TokenUser,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
  ): Promise<{ results: SearchHit[] }> {
    await this.gate(user.id);
    return {
      results: await this.search.search(
        typeof q === 'string' ? q : '',
        parseLimit(limit, MANUAL_SEARCH_DEFAULT_LIMIT, MANUAL_SEARCH_MAX_LIMIT),
      ),
    };
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_MANUAL, VIEW)
  @Get('graph')
  @ApiOperation({ summary: 'The map: pages as nodes, [[links]] as edges' })
  async map(@CurrentUser() user: TokenUser): Promise<ManualGraph> {
    await this.gate(user.id);
    return this.graph.graph();
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_MANUAL, VIEW)
  @Get('changes')
  @ApiOperation({
    summary: 'The change log, newest first; ?slug= narrows it to one page',
  })
  async changeLog(
    @CurrentUser() user: TokenUser,
    @Query('limit') limit?: string,
    @Query('slug') slug?: string,
  ): Promise<{ changes: ChangeRow[] }> {
    await this.gate(user.id);
    return {
      changes: await this.changes.list({
        slug: typeof slug === 'string' && slug ? slug : null,
        limit: parseLimit(
          limit,
          MANUAL_CHANGES_DEFAULT_LIMIT,
          MANUAL_CHANGES_MAX_LIMIT,
        ),
      }),
    };
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_MANUAL, VIEW)
  @Post('pages/:slug/revert')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Restore an older version of a page as a new version',
  })
  async revert(
    @Param('slug') slug: string,
    @Body() dto: RevertPageDto,
    @CurrentUser() user: TokenUser,
  ): Promise<PageDetail> {
    await this.gate(user.id, true);
    try {
      await this.pages.revert(slug, dto.revisionId, user.id);
    } catch (error) {
      throw manualErrorToHttp(error);
    }
    const detail = await this.pages.detail(slug);
    if (!detail) throw new NotFoundException('No such page.');
    return detail;
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_MANUAL, VIEW)
  @Get('state')
  @ApiOperation({
    summary: 'The agent, its budget, open proposals and what the caller may do',
  })
  async state(@CurrentUser() user: TokenUser): Promise<ManualState> {
    await this.gate(user.id);
    return this.stateService.state(user.id);
  }
}
