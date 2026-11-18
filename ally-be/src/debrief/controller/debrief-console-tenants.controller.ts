import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Put,
  Req,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { DebriefAct, DebriefRead } from '../util/debrief-console-roles.util';
import { DebriefConsoleViewService } from '../service/debrief-console-view.service';
import { DebriefConsoleAuditInterceptor } from '../interceptor/debrief-console-audit.interceptor';
import { DebriefAgentService } from '../service/debrief-agent.service';
import { DebriefConsoleService } from '../service/debrief-console.service';
import {
  TenantLiveDto,
  TenantRegionDto,
  TenantProvidersDto,
  EmergencyStopDto,
} from './dto/debrief-console.dto';
import { AuthedRequest } from './console-shared';

/**
 * Organisations: who is switched on, region, allowed providers and the emergency stop.
 * Part of the Debrief Console's API (plan §12); Ally team only, behind the same
 * ANALYTICS toggle as the calibration set.
 */
@ApiTags('Debriefs')
@Controller('v1/debriefs/console')
@UseInterceptors(DebriefConsoleAuditInterceptor)
@ApiBearerAuth()
@ApiSecurity('access-token')
export class DebriefConsoleTenantsController {
  constructor(
    private readonly console: DebriefConsoleService,
    private readonly agent: DebriefAgentService,
    private readonly view: DebriefConsoleViewService,
  ) {}

  @Get('tenants')
  @DebriefRead()
  @ApiOperation({
    summary: 'Organisations and whether their learners read the new debrief',
  })
  tenants() {
    return this.console.tenants();
  }

  @Put('tenants/:tenantId/live')
  @DebriefAct('emergencyStop')
  @ApiOperation({
    summary: "Switch an organisation's learners to the new debrief, or back",
    description: 'Off is the emergency stop for one organisation.',
  })
  async setLive(
    @Param('tenantId') tenantId: string,
    @Body() body: TenantLiveDto,
    @Req() req: AuthedRequest,
  ) {
    // Off is the emergency stop (Ally team or owner); on is the owner's.
    if (body.live && !(await this.view.viewer(req.user.id)).can.switchOrgOn) {
      throw new ForbiddenException(
        'Only the Debrief owner can switch an organisation on',
      );
    }
    await this.agent.setLive(tenantId, body.live, req.user.id);
    return { tenantId, live: body.live };
  }

  @Put('tenants/:tenantId/region')
  @DebriefAct('switchOrgOn')
  @ApiOperation({
    summary: 'Where an organisation works (v9 FR-25)',
    description:
      'Outside India there is no default support line: the organisation needs its own before it can be switched on.',
  })
  async setRegion(
    @Param('tenantId') tenantId: string,
    @Body() body: TenantRegionDto,
    @Req() req: AuthedRequest,
  ) {
    await this.agent.setRegion(tenantId, body.region, req.user.id);
    return { tenantId, region: body.region };
  }

  @Put('tenants/:tenantId/providers')
  @DebriefAct('switchOrgOn')
  @ApiOperation({
    summary:
      "Which approved model providers an organisation's debriefs may use",
    description:
      'Plan §8.9 / v9 FR-57: live runs, paired trials and Ask Ally on its sessions reach only these providers. At least one.',
  })
  async setProviders(
    @Param('tenantId') tenantId: string,
    @Body() body: TenantProvidersDto,
    @Req() req: AuthedRequest,
  ) {
    const providers = await this.agent.setProviderAllowlist(
      tenantId,
      body.providers,
      req.user.id,
    );
    return { tenantId, providers };
  }

  // --- Redesigned console (docs/debrief-harness/CONSOLE_API.md) ---------------------

  @Post('tenants/:tenantId/emergency-stop')
  @DebriefAct('emergencyStop')
  @ApiOperation({
    summary:
      'Emergency stop (PRD FR-46): the organisation is switched off; its learners see "not available", not today\'s debrief',
  })
  async emergencyStop(
    @Param('tenantId') tenantId: string,
    @Req() req: AuthedRequest,
    @Body() body: EmergencyStopDto,
  ) {
    await this.agent.setLive(tenantId, false, req.user.id);
    return {
      tenantId,
      live: false,
      learnersSee: 'not_available',
      reason: body.reason,
    };
  }

  // --- Ideas carry proposed changes; Releases is the live history -----------------
}
