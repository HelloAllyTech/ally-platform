import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { RequireFeatureToggle } from 'src/auth/decorators/feature-toggle.decorator';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import {
  AcceptCardDto,
  AnswerCardDto,
  FeedbackCardDto,
  LimitQueryDto,
  ListCardsQueryDto,
  PmCardDetailResponse,
  PmCardResponse,
  PmHealthResponse,
  PmLessonResponse,
  PmMemoryResponse,
  PmRunNowResponse,
  PmRunResponse,
  PmSettingsResponse,
  PmStateResponse,
  PmTrackingResponse,
  RejectCardDto,
  UpdateMemoryDto,
  UpdatePmAgentSettingsDto,
} from '../dto/pm-agent.dto';
import { PmAgentCardService } from '../service/pm-agent-card.service';
import { PmAgentMemoryService } from '../service/pm-agent-memory.service';
import { PmAgentSettingsService } from '../service/pm-agent-settings.service';
import { PmAgentStateService } from '../service/pm-agent-state.service';

type AuthedRequest = { user: { id: number } };

const CONFLICT = {
  status: 409,
  description:
    'Lost race or wrong state (another admin decided first, window closed)',
};
const INVALID = { status: 422, description: 'Invalid body for this card' };

/**
 * The PM Agent's HTTP surface (docs/pm-agent.md is the contract the admin UI codes
 * against — keep route names and shapes in step with it). Every route is behind the
 * `pm_agent` toggle; 403 when it is off.
 */
@ApiTags('PM Agent')
@Controller('v1/pm-agent')
@ApiBearerAuth()
@ApiSecurity('access-token')
export class PmAgentController {
  constructor(
    private readonly cardService: PmAgentCardService,
    private readonly stateService: PmAgentStateService,
    private readonly settingsService: PmAgentSettingsService,
    private readonly memoryService: PmAgentMemoryService,
  ) {}

  @Get('state')
  @RequireFeatureToggle(FeatureToggleKey.PM_AGENT)
  @ApiOperation({
    summary: 'Agent state, budget, queue and last run',
    description:
      '`agentState` is derived: disabled > running > budget_exhausted > queue_full > paused > idle. The UI polls this every 30 s as the socket fallback.',
  })
  getState(): Promise<PmStateResponse> {
    return this.stateService.getState();
  }

  @Get('cards')
  @RequireFeatureToggle(FeatureToggleKey.PM_AGENT)
  @ApiOperation({
    summary: 'Cards in review order',
    description:
      'Default: the review queue (open + needs-you). Ordered needs-you first, then questions, then recommendations by rank.',
  })
  listCards(
    @Query() query: ListCardsQueryDto,
  ): Promise<{ cards: PmCardResponse[] }> {
    return this.cardService.list(query);
  }

  @Get('cards/:id')
  @RequireFeatureToggle(FeatureToggleKey.PM_AGENT)
  @ApiOperation({ summary: 'One card with its evidence and audit events' })
  getCard(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PmCardDetailResponse> {
    return this.cardService.getDetail(id);
  }

  @Post('cards/:id/accept')
  @HttpCode(200)
  @RequireFeatureToggle(FeatureToggleKey.PM_AGENT)
  @ApiOperation({
    summary: 'Accept a recommendation: file it to the roadmap',
    description:
      'Status accepted_pending with undoUntil = now + 10 s; the card is filed to the roadmap as a Product Manager Agent opportunity after the window. `path` is ignored (legacy).',
  })
  @ApiResponse(CONFLICT)
  @ApiResponse(INVALID)
  accept(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AcceptCardDto,
    @Req() req: AuthedRequest,
  ): Promise<PmCardResponse> {
    return this.cardService.accept(req.user.id, id, body);
  }

  @Post('cards/:id/undo')
  @HttpCode(200)
  @RequireFeatureToggle(FeatureToggleKey.PM_AGENT)
  @ApiOperation({ summary: 'Undo an accept within the 10 s window' })
  @ApiResponse(CONFLICT)
  undo(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthedRequest,
  ): Promise<PmCardResponse> {
    return this.cardService.undo(req.user.id, id);
  }

  @Post('cards/:id/reject')
  @HttpCode(200)
  @RequireFeatureToggle(FeatureToggleKey.PM_AGENT)
  @ApiOperation({ summary: 'Reject a card (reason optional)' })
  @ApiResponse(CONFLICT)
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RejectCardDto,
    @Req() req: AuthedRequest,
  ): Promise<PmCardResponse> {
    return this.cardService.reject(req.user.id, id, body);
  }

  @Post('cards/:id/reason')
  @HttpCode(200)
  @RequireFeatureToggle(FeatureToggleKey.PM_AGENT)
  @ApiOperation({ summary: 'Add or replace a reject reason within 30 s' })
  @ApiResponse(CONFLICT)
  reason(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RejectCardDto,
    @Req() req: AuthedRequest,
  ): Promise<PmCardResponse> {
    return this.cardService.setReason(req.user.id, id, body);
  }

  @Post('cards/:id/feedback')
  @HttpCode(200)
  @RequireFeatureToggle(FeatureToggleKey.PM_AGENT)
  @ApiOperation({
    summary: 'Close a card with feedback; a revised card replaces it',
  })
  @ApiResponse(CONFLICT)
  feedback(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: FeedbackCardDto,
    @Req() req: AuthedRequest,
  ): Promise<PmCardResponse> {
    return this.cardService.feedback(req.user.id, id, body);
  }

  @Post('cards/:id/answer')
  @HttpCode(200)
  @RequireFeatureToggle(FeatureToggleKey.PM_AGENT)
  @ApiOperation({ summary: 'Answer a question (writes a memory fact)' })
  @ApiResponse(CONFLICT)
  @ApiResponse(INVALID)
  answer(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AnswerCardDto,
    @Req() req: AuthedRequest,
  ): Promise<PmCardResponse> {
    return this.cardService.answer(req.user.id, id, body);
  }

  @Post('cards/:id/skip')
  @HttpCode(200)
  @RequireFeatureToggle(FeatureToggleKey.PM_AGENT)
  @ApiOperation({ summary: 'Skip a question (not re-asked for 14 days)' })
  @ApiResponse(CONFLICT)
  @ApiResponse(INVALID)
  skip(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthedRequest,
  ): Promise<PmCardResponse> {
    return this.cardService.skip(req.user.id, id);
  }

  @Post('cards/:id/retry')
  @HttpCode(200)
  @RequireFeatureToggle(FeatureToggleKey.PM_AGENT)
  @ApiOperation({ summary: 'Retry filing a needs-attention card' })
  @ApiResponse(CONFLICT)
  retry(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthedRequest,
  ): Promise<PmCardResponse> {
    return this.cardService.retry(req.user.id, id);
  }

  @Post('cards/:id/file-anyway')
  @HttpCode(200)
  @RequireFeatureToggle(FeatureToggleKey.PM_AGENT)
  @ApiOperation({
    summary:
      'File a card the roadmap duplicate check stopped, over that check (every other check still runs)',
  })
  @ApiResponse(CONFLICT)
  fileAnyway(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthedRequest,
  ): Promise<PmCardResponse> {
    return this.cardService.fileAnyway(req.user.id, id);
  }

  @Post('cards/:id/dismiss')
  @HttpCode(200)
  @RequireFeatureToggle(FeatureToggleKey.PM_AGENT)
  @ApiOperation({ summary: 'Take a needs-you item off the list' })
  @ApiResponse(CONFLICT)
  dismiss(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthedRequest,
  ): Promise<PmCardResponse> {
    return this.cardService.dismiss(req.user.id, id);
  }

  @Get('tracking')
  @RequireFeatureToggle(FeatureToggleKey.PM_AGENT)
  @ApiOperation({ summary: 'Accepted work, grouped, with delivery' })
  tracking(): Promise<PmTrackingResponse> {
    return this.stateService.tracking();
  }

  @Post('run')
  @HttpCode(200)
  @RequireFeatureToggle(FeatureToggleKey.PM_AGENT)
  @ApiOperation({
    summary: 'Run now',
    description:
      'Respects the kill switch, budget and queue cap. `started: false` with a `reason` is a normal answer.',
  })
  runNow(@Req() req: AuthedRequest): Promise<PmRunNowResponse> {
    return this.stateService.runNow(req.user.id);
  }

  @Get('runs')
  @RequireFeatureToggle(FeatureToggleKey.PM_AGENT)
  @ApiOperation({ summary: 'Recent runs' })
  runs(@Query() query: LimitQueryDto): Promise<{ runs: PmRunResponse[] }> {
    return this.stateService.listRuns(query.limit ?? 20);
  }

  @Get('settings')
  @RequireFeatureToggle(FeatureToggleKey.PM_AGENT)
  @ApiOperation({ summary: 'Settings' })
  getSettings(): Promise<PmSettingsResponse> {
    return this.settingsService.getResponse();
  }

  @Patch('settings')
  @RequireFeatureToggle(FeatureToggleKey.PM_AGENT)
  @ApiOperation({
    summary: 'Change settings',
    description:
      'queueCap 1..10, runHourIst 0..23, monthlyBudgetUsd >= 0. autoBuildPaused=false resumes after the circuit breaker.',
  })
  updateSettings(
    @Body() body: UpdatePmAgentSettingsDto,
    @Req() req: AuthedRequest,
  ): Promise<PmSettingsResponse> {
    return this.settingsService.update(req.user.id, body);
  }

  @Get('memory')
  @RequireFeatureToggle(FeatureToggleKey.PM_AGENT)
  @ApiOperation({ summary: 'Memory facts and lessons' })
  memory(): Promise<{
    facts: PmMemoryResponse[];
    lessons: PmLessonResponse[];
  }> {
    return this.memoryService.list();
  }

  @Patch('memory/:id')
  @RequireFeatureToggle(FeatureToggleKey.PM_AGENT)
  @ApiOperation({ summary: 'Edit or (de)activate a memory item' })
  updateMemory(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateMemoryDto,
    @Req() req: AuthedRequest,
  ): Promise<PmMemoryResponse | PmLessonResponse> {
    return this.memoryService.update(req.user.id, id, body);
  }

  @Delete('memory/:id')
  @RequireFeatureToggle(FeatureToggleKey.PM_AGENT)
  @ApiOperation({
    summary: 'Delete a memory item (a lesson is marked removed, not deleted)',
  })
  deleteMemory(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthedRequest,
  ): Promise<PmMemoryResponse | PmLessonResponse> {
    return this.memoryService.remove(id, req.user?.id ?? null);
  }

  @Get('history')
  @RequireFeatureToggle(FeatureToggleKey.PM_AGENT)
  @ApiOperation({
    summary: 'Decided cards: rejected, feedback, answered, skipped, expired',
  })
  history(@Query() query: LimitQueryDto): Promise<{ cards: PmCardResponse[] }> {
    return this.stateService.history(query.limit ?? 50);
  }

  @Get('health')
  @RequireFeatureToggle(FeatureToggleKey.PM_AGENT)
  @ApiOperation({ summary: 'Accept rate, shipped rate, cost, spend by lane' })
  health(): Promise<PmHealthResponse> {
    return this.stateService.health();
  }
}
