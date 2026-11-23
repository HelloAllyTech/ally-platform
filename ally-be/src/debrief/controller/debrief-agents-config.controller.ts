import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Post,
  Req,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { IsArray, IsOptional, IsString, MaxLength } from 'class-validator';
import { DebriefConsoleAuditInterceptor } from '../interceptor/debrief-console-audit.interceptor';
import { DebriefAgentsConfigService } from '../service/debrief-agents-config.service';
import { DebriefConsoleViewService } from '../service/debrief-console-view.service';
import { AgentsConfigChange } from '../util/debrief-agents-config.util';
import { DebriefAct, DebriefRead } from '../util/debrief-console-roles.util';

class AgentsConfigChangesDto {
  @IsArray()
  changes!: AgentsConfigChange[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

type AuthedRequest = { user: { id: number } };

/**
 * Settings › Agents: the live agent configuration, and changes to it as DRAFT
 * releases (never a live edit). Reads like the other Debrief settings reads;
 * changes need the Debrief owner's `manage:admin:debrief-settings`.
 */
@ApiTags('Debriefs')
@Controller('v1/debriefs/agents-config')
@UseInterceptors(DebriefConsoleAuditInterceptor)
@ApiBearerAuth()
@ApiSecurity('access-token')
export class DebriefAgentsConfigController {
  constructor(
    private readonly agents: DebriefAgentsConfigService,
    private readonly view: DebriefConsoleViewService,
  ) {}

  @Get()
  @DebriefRead()
  @ApiOperation({
    summary:
      'The live release’s agents: each recipe step’s model, guidance settings, orchestrator agents and approved models',
  })
  async get(@Req() req: AuthedRequest) {
    const can = (await this.view.viewer(req.user.id)).can;
    return this.agents.view(req.user.id, !!can.ownerSettings);
  }

  @Post('changes')
  @DebriefAct('ownerSettings')
  @ApiOperation({
    summary: 'Make a DRAFT release from the live one with these changes',
  })
  async change(
    @Req() req: AuthedRequest,
    @Body() body: AgentsConfigChangesDto,
  ) {
    const can = (await this.view.viewer(req.user.id)).can;
    if (!can.ownerSettings) {
      throw new ForbiddenException('Changing agents needs the Debrief owner');
    }
    return this.agents.propose(body.changes, body.note ?? '', req.user.id);
  }
}
