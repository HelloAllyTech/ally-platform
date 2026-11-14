import {
  Body,
  Controller,
  Headers,
  HttpCode,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from 'src/auth/decorators/auth.metadata';
import { DebriefGatewayService } from '../service/debrief-gateway.service';
import {
  DebriefGatewayTool,
  DebriefRunTokenService,
  GATEWAY_TOOLS,
  PM_AGENT_GATEWAY_TOOLS,
  PmAgentGatewayTool,
} from '../service/debrief-run-token.service';
import { DebriefPmAgentToolsService } from '../service/debrief-pm-agent-tools.service';

/**
 * The Debrief gateway (docs/debrief-harness/CONTRACT.md §2, §5): the tools
 * ally-ai's debrief graph calls back mid-run, and Ask Ally's agent mid-reply. Machine-only: `@Public()` to the
 * user-auth guard and no user JWT is ever read here; the only credential is
 * the run token ally-be signed for this run (`Authorization: Bearer`), checked
 * for signature, expiry, the tool, and a run that is still running.
 *
 * The PM agent's tools (`PM_AGENT_GATEWAY_TOOLS`) share the route but take an
 * agent token (`DebriefRunTokenService.signAgent`) instead; their rules live in
 * DebriefPmAgentToolsService.
 */
@ApiExcludeController()
@Controller('v1/internal/debrief')
export class DebriefGatewayController {
  constructor(
    private readonly tokens: DebriefRunTokenService,
    private readonly gateway: DebriefGatewayService,
    private readonly pmTools: DebriefPmAgentToolsService,
  ) {}

  @Public()
  @Post('tools/:name')
  @HttpCode(200)
  async tool(
    @Param('name') name: string,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: Record<string, any>,
  ): Promise<Record<string, unknown>> {
    if ((PM_AGENT_GATEWAY_TOOLS as readonly string[]).includes(name)) {
      // The PM agent's tools take an agent token, never a debrief run's.
      const claims = this.tokens.authoriseAgent(authorization, name);
      return this.pmTools.call(name as PmAgentGatewayTool, claims, body ?? {});
    }
    if (!GATEWAY_TOOLS.includes(name as DebriefGatewayTool)) {
      throw new NotFoundException(`No debrief tool ${name}`);
    }
    const { run, claims } = await this.tokens.authorise(authorization, name);
    const b = body ?? {};
    switch (name as DebriefGatewayTool) {
      case 'guidance_search':
        return this.gateway.guidanceSearch(run, b);
      case 'run_checks':
        return this.gateway.runChecks(run, b as any);
      case 'render_cards':
        return this.gateway.renderCards(b as any);
      case 'finalise_cards':
        return this.gateway.finaliseCards(b as any);
      case 'progress':
        return this.gateway.progress(run, b as any);
      case 'get_learner_history':
        // Ask Ally's reply token reads the learner's points; a debrief run's
        // token (orchestrated releases only) reads their past debriefs.
        return claims.scope === 'reply'
          ? this.gateway.learnerHistory(run, claims, b)
          : this.gateway.runLearnerHistory(run, b);
      case 'get_live_detections':
        return this.gateway.liveDetections(run);
      case 'get_org_protocols':
        return this.gateway.orgProtocols(run);
      case 'query_aggregates':
        return this.gateway.queryAggregates(run, b);
    }
  }
}
