import { Injectable } from '@nestjs/common';
import { AnalyticsAgentService } from 'src/analytics-agent/service/analytics-agent.service';
import { MANUAL_CHAT_LIMITS } from '../constants/manual-agent.constants';

/**
 * The chat's one door into the Analytics Agent, for `analytics_ask`. The chat service offers the
 * tool only to callers holding the `analytics_agent` toggle; the agent then runs as that user, so
 * it can read exactly what they could ask it themselves.
 *
 * A 90 s deadline (the contract's) raced against the answer, as Builder's evidence belt does: the
 * analytics agent plans, runs SQL and summarises, and a chat turn must not hang on it. Never
 * throws; a failure is `{ok:false,error}` the model can read.
 */
@Injectable()
export class ManualAnalyticsPort {
  constructor(private readonly analyticsAgent: AnalyticsAgentService) {}

  async ask(
    question: string,
    userId: number,
    timeoutMs: number = MANUAL_CHAT_LIMITS.ANALYTICS_TIMEOUT_MS,
  ): Promise<Record<string, any>> {
    const trimmed = String(question ?? '').trim();
    if (!trimmed) return { ok: false, error: 'Ask a question first.' };
    let timer: NodeJS.Timeout | undefined;
    try {
      const answer = await Promise.race([
        this.analyticsAgent.ask({ question: trimmed } as never, userId),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error(
                  `Analytics did not answer within ${Math.round(timeoutMs / 1000)} s.`,
                ),
              ),
            timeoutMs,
          );
        }),
      ]);
      return {
        ok: true,
        outcome: answer.outcome,
        answer: answer.answer ?? null,
        message: answer.message || null,
        sql: answer.sql ?? null,
        rowCount: answer.rows?.length ?? 0,
        caveats: answer.caveats ?? [],
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
