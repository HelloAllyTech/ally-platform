import { Controller, Get, ParseIntPipe, Query } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { RequireFeatureToggle } from 'src/auth/decorators/feature-toggle.decorator';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { DEBRIEF_AGENT_KEY } from '../constants/debrief-release.constants';

/**
 * What Simulation Studio asks about a roleplay's Debrief (the risk-cue yes/no and its note) is
 * saved on the roleplay itself. This route only says whether the new Debrief is switched on for it.
 */
@ApiTags('Debriefs')
@Controller('v1/debriefs/roleplay-options')
@ApiBearerAuth()
@ApiSecurity('access-token')
export class DebriefRoleplayOptionsController {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Whether Simulation Studio shows the Debrief choice for this roleplay: only where the new
   * Debrief runs. A roleplay assigned to at least one organisation that has it switched on (or a
   * global one, with any organisation on), and for a roleplay not saved yet, any organisation on.
   * Other organisations keep today's debrief, which this choice never touches.
   */
  @Get('availability')
  @RequireFeatureToggle(FeatureToggleKey.CREATE_ROLEPLAYS)
  @ApiOperation({
    summary:
      'Whether the new Debrief is switched on for this roleplay (the Studio shows the Debrief choices only then)',
  })
  async availability(
    @Query('scenarioId', new ParseIntPipe({ optional: true }))
    scenarioId?: number,
  ) {
    const [row] = await this.dataSource.query(
      `SELECT EXISTS (
         SELECT 1 FROM agent_config_overrides o
          WHERE o."agentKey" = $2 AND o.layer = 'org'
            AND COALESCE((o."values"->>'live')::boolean, false)
            AND ($1::int IS NULL
                 OR EXISTS (SELECT 1 FROM scenario_tenants st
                             WHERE st."scenarioId" = $1 AND st."deletedAt" IS NULL
                               AND st."tenantId"::text = o."scopeId")
                 OR EXISTS (SELECT 1 FROM scenarios sc
                             WHERE sc.id = $1 AND sc."isGlobal" = true))
       ) AS enabled`,
      [scenarioId ?? null, DEBRIEF_AGENT_KEY],
    );
    return { enabled: row?.enabled === true };
  }
}
