import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
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
import { PlanSettingsService } from 'src/product-planning/service/plan-settings.service';
import { CreateManualAgentKeyDto } from '../dto/manual-chat.dto';
import {
  ManualAgentKeyRow,
  ManualAgentKeyService,
} from '../service/manual-agent-key.service';
import { ManualWeeklyAgentService } from '../service/manual-weekly-agent.service';

/**
 * The agent half of the manual's admin surface: Run now and the coding agents' proposal keys. Same
 * gate as the core admin controller (Roadmap Manage toggle, 404 while Roadmap v2 is off).
 */
@ApiTags('Product Manual')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller({ path: 'product-manual/admin', version: '1' })
export class ManualAgentAdminController {
  constructor(
    private readonly settings: PlanSettingsService,
    private readonly weekly: ManualWeeklyAgentService,
    private readonly keys: ManualAgentKeyService,
  ) {}

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP_MANAGE)
  @Post('run')
  @ApiOperation({
    summary:
      'Run the weekly agent now (same guards as the schedule; 409 when off, out of budget or already running)',
  })
  async runNow(@CurrentUser() user: TokenUser): Promise<{ runId: string }> {
    await this.settings.assertRoadmapV2();
    return this.weekly.start(user.id);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP_MANAGE)
  @Get('agent-keys')
  @ApiOperation({ summary: 'Coding-agent keys for the proposal MCP' })
  async listKeys(): Promise<{ keys: ManualAgentKeyRow[] }> {
    await this.settings.assertRoadmapV2();
    return { keys: await this.keys.list() };
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP_MANAGE)
  @Post('agent-keys')
  @ApiOperation({
    summary: 'Create a key. The key (pmk_…) is in this response only.',
  })
  async createKey(
    @Body() dto: CreateManualAgentKeyDto,
    @CurrentUser() user: TokenUser,
  ): Promise<{ id: string; key: string }> {
    await this.settings.assertRoadmapV2();
    return this.keys.create(user.id, dto.label);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP_MANAGE)
  @Delete('agent-keys/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke a key' })
  async revokeKey(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.settings.assertRoadmapV2();
    await this.keys.revoke(id);
  }
}
