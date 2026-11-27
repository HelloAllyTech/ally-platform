import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
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
import { PlanSettingsService } from 'src/product-planning/service/plan-settings.service';
import {
  MANUAL_RUNS_DEFAULT_LIMIT,
  MANUAL_RUNS_MAX_LIMIT,
} from '../constants/manual.constants';
import { ImportPagesDto, UpdateManualSettingsDto } from '../dto/manual.dto';
import { ManualImportService } from '../service/manual-import.service';
import { ManualPageService } from '../service/manual-page.service';
import {
  ManualProposalService,
  toProposalView,
} from '../service/manual-proposal.service';
import { ManualSettingsService } from '../service/manual-settings.service';
import { ManualStateService } from '../service/manual-state.service';
import type {
  ImportPage,
  ImportResult,
  ManualProposalStatus,
  ManualSettingsView,
  ProposalView,
  RunRow,
} from '../type/manual.types';
import { manualErrorToHttp, parseLimit } from '../util/manual-http.util';

/**
 * The Product Manual's admin surface: settings, runs, proposals, import and "mark released". Gated by
 * the Roadmap Manage toggle (the Owner); each handler also answers 404 while Roadmap v2 is off.
 * Run-now and the agent keys live in the agent half of the module.
 */
@ApiTags('Product Manual')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller({ path: 'product-manual/admin', version: '1' })
export class ManualAdminController {
  constructor(
    private readonly settings: PlanSettingsService,
    private readonly manualSettings: ManualSettingsService,
    private readonly stateService: ManualStateService,
    private readonly proposals: ManualProposalService,
    private readonly importer: ManualImportService,
    private readonly pages: ManualPageService,
  ) {}

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP_MANAGE)
  @Get('settings')
  @ApiOperation({ summary: 'Weekly agent switch and monthly budget' })
  async getSettings(): Promise<ManualSettingsView> {
    await this.settings.assertRoadmapV2();
    return this.manualSettings.get();
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP_MANAGE)
  @Patch('settings')
  @ApiOperation({
    summary:
      'Turn the weekly agent on or off; set the monthly budget (1 to 2000 USD)',
  })
  async updateSettings(
    @Body() dto: UpdateManualSettingsDto,
    @CurrentUser() user: TokenUser,
  ): Promise<ManualSettingsView> {
    await this.settings.assertRoadmapV2();
    return this.manualSettings.update(
      { enabled: dto.enabled, monthlyBudgetUsd: dto.monthlyBudgetUsd },
      user.id,
    );
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP_MANAGE)
  @Get('runs')
  @ApiOperation({ summary: 'Recent weekly / run-now passes, newest first' })
  async runs(@Query('limit') limit?: string): Promise<{ runs: RunRow[] }> {
    await this.settings.assertRoadmapV2();
    return {
      runs: await this.stateService.listRuns(
        parseLimit(limit, MANUAL_RUNS_DEFAULT_LIMIT, MANUAL_RUNS_MAX_LIMIT),
      ),
    };
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP_MANAGE)
  @Get('proposals')
  @ApiOperation({
    summary: 'Proposals and gaps, newest first; ?status=open|applied|dismissed',
  })
  async listProposals(
    @Query('status') status?: string,
  ): Promise<{ proposals: ProposalView[] }> {
    await this.settings.assertRoadmapV2();
    try {
      const rows = await this.proposals.list(
        status ? (status as ManualProposalStatus) : undefined,
      );
      return { proposals: rows.map(toProposalView) };
    } catch (error) {
      throw manualErrorToHttp(error);
    }
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP_MANAGE)
  @Post('proposals/:id/dismiss')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Dismiss an open proposal' })
  async dismiss(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.settings.assertRoadmapV2();
    await this.proposals.dismiss(id);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP_MANAGE)
  @Post('import')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Bulk upsert pages by slug (up to 200 per call); content is never committed to git',
  })
  async importPages(
    @Body() dto: ImportPagesDto,
    @CurrentUser() user: TokenUser,
  ): Promise<ImportResult> {
    await this.settings.assertRoadmapV2();
    return this.importer.import(dto.pages as unknown as ImportPage[], user.id);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP_MANAGE)
  @Post('mark-released')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'A release went out: every "ships in next release" page becomes live',
  })
  async markReleased(): Promise<{ cleared: number }> {
    await this.settings.assertRoadmapV2();
    return { cleared: await this.pages.markAllReleased() };
  }
}
