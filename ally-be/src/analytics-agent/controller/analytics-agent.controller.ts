import {
  Body,
  Controller,
  Get,
  Logger,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
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
  AnalyticsAgentCatalogResponseDto,
  AnalyticsAgentConversationDetailDto,
  AnalyticsAgentConversationSummaryDto,
  AnalyticsAgentFeedbackResponseDto,
  AskAnalyticsAgentDto,
  AskAnalyticsAgentResponseDto,
  SetAnalyticsAgentFeedbackDto,
} from '../dto/analytics-agent.dto';
import { AnalyticsAgentConversationService } from '../service/analytics-agent-conversation.service';
import { AnalyticsAgentService } from '../service/analytics-agent.service';
import { invokeAnalyticalAgent } from '../service/new-analytical-agent.service';
import { resultFieldsFromRun } from '../util/analytics-agent-result.util';

/**
 * The Analytics Agent's HTTP surface — ask, catalogue, and the caller's saved
 * conversations — gated on
 * SUPER_ADMIN_ROLES, the same tier as the rest of `/v1/analytics`.
 *
 * This used to sit on the elevated SUPER_DUPER_ADMIN_ROLES tier: every other
 * endpoint on that controller answers one fixed, reviewed question, while this
 * one answers whatever question the reader types, across every allowlisted
 * table, at platform scope. That reasoning still holds as a general principle
 * (broader capability warrants a stricter gate), but the product decision was
 * made to give every admin tier parity across all analytics surfaces instead.
 * What makes that safe here is `analytics-agent.constants.ts`'s ALLOWED_TABLES:
 * every tenant-attributable table it names is a filtered view that already
 * excludes test-tenant rows structurally, so widening who can ask a question
 * does not widen what the question can see.
 */
@ApiTags('Analytics Agent')
@Controller('v1/analytics/agent')
@ApiBearerAuth()
@ApiSecurity('access-token')
export class AnalyticsAgentController {
  private readonly logger = new Logger(AnalyticsAgentController.name);

  constructor(
    private readonly analyticsAgentService: AnalyticsAgentService,
    private readonly conversationService: AnalyticsAgentConversationService,
  ) {}

  @Post('ask')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS_AGENT)
  @ApiOperation({
    summary: 'Ask an analytics question in English',
    description:
      'Turns the question into one read-only SELECT over an allowlisted subset of ' +
      'the schema, runs it inside a READ ONLY transaction with a statement timeout ' +
      'and a row cap, and returns the rows plus a narrated answer, caveats and an ' +
      'optional chart specification.\n\n' +
      'The response always says which of five things happened (`outcome`): the ' +
      'question was answered, it needs clarifying, it cannot be answered from the ' +
      'readable tables, the generated SQL was refused by the guard, or the query ' +
      'failed to run. The SQL is returned whenever one was generated — including ' +
      'when it was refused — because a number nobody can audit is not an answer.\n\n' +
      'Pass prior turns in `history` for follow-up questions — the agent itself ' +
      'holds no state. Pass `conversationId` to append the turn to a saved ' +
      'conversation; omit it to start a new one (titled with this question). The ' +
      'response carries the `conversationId` the turn was saved under.',
  })
  @ApiResponse({
    status: 200,
    description: 'The turn was processed (see `outcome` for what happened)',
    type: AskAnalyticsAgentResponseDto,
  })
  async ask(
    @Body() body: AskAnalyticsAgentDto,
    @Req() req: { user: { id: number } },
  ): Promise<AskAnalyticsAgentResponseDto> {
    const userId = req.user?.id;
    // Fail on a bad conversation id before spending an agent run on it.
    if (body.conversationId) {
      await this.conversationService.assertOwned(userId, body.conversationId);
    }

    // Previous SQL-planner pipeline, kept for now:
    // return this.analyticsAgentService.ask(body, req.user?.id);

    const run = await invokeAnalyticalAgent(
      body.question,
      body.history ?? [],
      String(userId),
    );
    const { response, queries } = run;
    const fields = resultFieldsFromRun(run);
    const result: AskAnalyticsAgentResponseDto = {
      outcome: fields.outcome,
      question: body.question,
      message: fields.message,
      answer: response.response,
      sql: queries
        .map((q) => q.sql)
        .filter(Boolean)
        .join('\n\n'),
      rationale: '',
      columns: fields.columns,
      rows: fields.rows,
      rowCount: fields.rowCount,
      truncated: fields.truncated,
      // The agent writes no chart specification, so there is nothing to draw.
      chart: null,
      caveats: [],
      followUps: response.followUps ?? [],
      ...(response.needsUserInput ? { needsUserInput: true } : {}),
      durationMs: fields.durationMs,
      provenance: fields.provenance,
    };

    // The answer already cost a full agent run, so a failure to save it must
    // not throw it away: log, and return the answer without a conversation id.
    try {
      const saved = await this.conversationService.saveTurn(
        userId,
        body.conversationId,
        body.question,
        result,
      );
      result.conversationId = saved.conversationId;
      result.messageId = saved.messageId;
    } catch (err) {
      this.logger.error(
        `Could not save analytics agent turn: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return result;
  }

  @Get('conversations')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS_AGENT)
  @ApiOperation({
    summary: "The caller's saved conversations",
    description:
      'Most recently active first. Titles are the first question asked; turns ' +
      "are fetched per conversation. Only ever the caller's own conversations.",
  })
  @ApiResponse({
    status: 200,
    description: 'Conversations retrieved successfully',
    type: [AnalyticsAgentConversationSummaryDto],
  })
  async listConversations(
    @Req() req: { user: { id: number } },
  ): Promise<AnalyticsAgentConversationSummaryDto[]> {
    return this.conversationService.list(req.user?.id);
  }

  @Get('conversations/:id')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS_AGENT)
  @ApiOperation({
    summary: 'One saved conversation with all its messages',
    description:
      'Every turn, oldest first, each with the full response as it was ' +
      'returned when asked. 404 if the conversation does not exist or is not ' +
      "the caller's.",
  })
  @ApiResponse({
    status: 200,
    description: 'Conversation retrieved successfully',
    type: AnalyticsAgentConversationDetailDto,
  })
  @ApiResponse({ status: 404, description: 'Conversation not found' })
  async getConversation(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: { user: { id: number } },
  ): Promise<AnalyticsAgentConversationDetailDto> {
    return this.conversationService.get(req.user?.id, id);
  }

  @Put('messages/:id/feedback')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS_AGENT)
  @ApiOperation({
    summary: 'Rate one answer with a thumbs up or down',
    description:
      "Records the caller's optional feedback on one answer in their own " +
      'conversations. Send `up` or `down` to set or change it, or `null` to ' +
      'withdraw it. Feedback is never required, and 404 if the message does not ' +
      "exist or is not in one of the caller's conversations.",
  })
  @ApiResponse({
    status: 200,
    description: 'Feedback saved',
    type: AnalyticsAgentFeedbackResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Message not found' })
  async setFeedback(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SetAnalyticsAgentFeedbackDto,
    @Req() req: { user: { id: number } },
  ): Promise<AnalyticsAgentFeedbackResponseDto> {
    return this.conversationService.setFeedback(
      req.user?.id,
      id,
      body.feedback,
    );
  }

  @Get('catalog')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS_AGENT)
  @ApiOperation({
    summary: 'Tables and columns the agent can read',
    description:
      'The readable catalogue, so the UI can tell a reader what is in scope ' +
      'before they ask — and state the columns that are never readable, rather ' +
      'than leaving that policy to be discovered by being refused.',
  })
  @ApiResponse({
    status: 200,
    description: 'Catalogue retrieved successfully',
    type: AnalyticsAgentCatalogResponseDto,
  })
  async getCatalog(): Promise<AnalyticsAgentCatalogResponseDto> {
    return this.analyticsAgentService.getCatalog();
  }
}
