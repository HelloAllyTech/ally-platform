import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiService } from '../../ai/service/ai.service';
import { AppConfigService } from '../../config/config.service';
import { LoggerService } from '../../logger/logger.service';
import {
  AGENT_SHADOW_RUN_EVENT,
  agentFailureReason,
  type AgentShadowRunEvent,
  MalformedAgentResponseError,
  shadowSide,
} from '../engine/agent-runtime';
import {
  AgentShadowRun,
  AgentShadowSide,
} from '../entity/agent-shadow-run.entity';

/**
 * Runs a shadow bot's message through the Agents v2 engine AFTER v1's reply has gone out, and
 * records how the two compared in `agent_shadow_runs`.
 *
 * It must never touch the real reply, so `start` returns at once and never throws: the run is not
 * awaited by the inbound handler (it cannot delay the SQS ack or trigger a redelivery), and every
 * failure is caught and logged here. At most `AGENT_SHADOW_MAX_IN_FLIGHT` runs per instance; past
 * that a message is skipped — not queued — and counted, so a burst of traffic cannot pile up
 * ally-ai calls behind it. The comparison is therefore a sample under load, not a census.
 */
@Injectable()
export class ChatbotShadowService {
  private readonly logger = LoggerService.getInstance(
    ChatbotShadowService.name,
  );
  private inFlight = 0;
  private skipped = 0;

  constructor(
    @InjectRepository(AgentShadowRun)
    private readonly repository: Repository<AgentShadowRun>,
    private readonly aiService: AiService,
    private readonly config: AppConfigService,
  ) {}

  /** Runs in flight and messages skipped at the cap, since this instance started. */
  get stats(): { inFlight: number; skipped: number } {
    return { inFlight: this.inFlight, skipped: this.skipped };
  }

  /**
   * Start one comparison in the background: the channel's announcement, sent after it replied.
   * Returns immediately; never throws.
   */
  @OnEvent(AGENT_SHADOW_RUN_EVENT)
  start(input: AgentShadowRunEvent): void {
    try {
      const max = this.config.agentShadow.maxInFlight;
      if (this.inFlight >= max) {
        this.skipped += 1;
        this.logger.warn(
          `Shadow run skipped for chatbot ${input.chatbotId}: ${this.inFlight} in flight ` +
            `(cap ${max}); ${this.skipped} skipped since start`,
        );
        return;
      }
      this.inFlight += 1;
      void this.run(input)
        .catch((error: unknown) =>
          this.logger.warn(
            `Shadow run failed for chatbot ${input.chatbotId}: ${
              error instanceof Error ? error.message : 'unknown error'
            }`,
          ),
        )
        .finally(() => {
          this.inFlight -= 1;
        });
    } catch (error) {
      this.logger.warn(
        `Shadow run could not start for chatbot ${input.chatbotId}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }

  private async run(input: AgentShadowRunEvent): Promise<void> {
    const { shadow } = input;
    const startedAt = Date.now();
    let v2: AgentShadowSide | null = null;
    let error: string | null = null;
    try {
      const response = await this.aiService.runAgent(shadow.request);
      if (!response?.intent) throw new MalformedAgentResponseError();
      v2 = {
        ...shadowSide(response, Date.now() - startedAt),
        trace_steps: response.trace?.length ?? 0,
      };
    } catch (failure) {
      error = agentFailureReason(failure);
    }
    // Numbers and ids only: the question and both answers stay out of this table.
    await this.repository
      .createQueryBuilder()
      .insert()
      .into(AgentShadowRun)
      .values({
        chatbotId: input.chatbotId,
        conversationId: input.conversationId,
        inboundMessageId: input.inboundMessageId,
        runId: shadow.request.run_id,
        v1: shadow.v1,
        v2,
        error,
      })
      .orIgnore()
      .execute();
  }
}
