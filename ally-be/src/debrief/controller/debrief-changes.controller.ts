import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { DebriefConsoleAuditInterceptor } from '../interceptor/debrief-console-audit.interceptor';
import { DebriefChangesService } from '../service/debrief-changes.service';
import { DebriefConsoleViewService } from '../service/debrief-console-view.service';
import { DebriefScoreService } from '../service/debrief-score.service';
import { DebriefAct, DebriefRead } from '../util/debrief-console-roles.util';

class ChangeReasonDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

type AuthedRequest = { user: { id: number } };

/**
 * Debrief v2, autonomy by default (docs/debrief-harness/V2_AUTONOMY.md, API
 * contract): Home, Changes with Undo now and Stop now, and the cumulative
 * score. Same base path, guards and audit as the console controller.
 */
@ApiTags('Debriefs')
@Controller('v1/debriefs/console')
@UseInterceptors(DebriefConsoleAuditInterceptor)
@ApiBearerAuth()
@ApiSecurity('access-token')
export class DebriefChangesController {
  constructor(
    private readonly changes: DebriefChangesService,
    private readonly score: DebriefScoreService,
    private readonly view: DebriefConsoleViewService,
  ) {}

  @Get('home')
  @DebriefRead()
  @ApiOperation({
    summary:
      'Home (v2): the score headline, changes that wait for a person (always-ask only) and this week',
  })
  async home(@Req() req: AuthedRequest) {
    // The clinical advisor sees only the pinned-rule changes they decide (spec C5).
    const can = (await this.view.viewer(req.user.id)).can;
    return this.changes.home(new Date(), {
      pinnedRulesOnly: !can.pmAgent,
    });
  }

  @Get('changes')
  @DebriefRead()
  @ApiOperation({
    summary:
      "The PM agent's changes in plain words, newest activity first; ?state=waits|trying|building|testing|live|undone|stopped|turned_down",
  })
  list(@Query('state') state?: string) {
    return this.changes.list(state);
  }

  @Get('changes/:id')
  @DebriefRead()
  @ApiOperation({ summary: 'One change: result, why, measures and steps' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.changes.get(id);
  }

  @Post('changes/:id/undo')
  @DebriefAct('releases')
  @ApiOperation({
    summary:
      'Undo now: the release before this live change is live for everyone again',
  })
  undo(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthedRequest,
    @Body() body: ChangeReasonDto,
  ) {
    return this.changes.undo(id, req.user.id, body?.reason);
  }

  @Post('changes/:id/stop')
  @DebriefAct('releases')
  @ApiOperation({
    summary:
      'Stop now: a change being tried on learners or tested goes no further',
  })
  stop(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthedRequest,
    @Body() body: ChangeReasonDto,
  ) {
    return this.changes.stop(id, req.user.id, body?.reason);
  }

  @Get('metrics/score')
  @DebriefRead()
  @ApiOperation({
    summary:
      'The cumulative score: this week and last, by week with change markers, its measures, the two gates, by language',
  })
  scoreView(@Query('days') days?: string) {
    return this.score.view(days ? Number(days) || 56 : 56);
  }
}
