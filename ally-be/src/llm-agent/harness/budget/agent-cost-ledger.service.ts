import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { computeCostUsd } from 'src/analytics/constants/llm-pricing.constants';
import { LoggerService } from 'src/logger/logger.service';
import { AgentCostLedger } from '../../entity/agent-cost-ledger.entity';
import { AgentUsage } from '../../type/agent-llm.type';

export interface AgentCostLine {
  agentKey: string;
  /** Which part of the agent spent it (orchestrator, sentinel, tutor…). */
  role: string;
  provider: string;
  model: string;
  usage: AgentUsage | undefined;
  threadId?: string | null;
  turnId?: string | null;
  userId?: number | null;
  visitorId?: string | null;
  tenantId?: string | null;
}

/**
 * Per-call cost lines for harness agents (plans/ally-guide/plan.md §7.3,
 * Appendix A budgets). Separate from `llm_usage`, which is the platform's
 * spend analytics: this ledger is what an agent reads back at runtime to
 * decide its budget tier, so it is keyed by thread, learner and visitor and
 * priced at write time.
 *
 * Recording never throws. A ledger write that fails costs budget accuracy;
 * failing the learner's turn over it would cost the learner.
 */
@Injectable()
export class AgentCostLedgerService {
  private readonly logger = LoggerService.getInstance(
    AgentCostLedgerService.name,
  );

  constructor(
    @InjectRepository(AgentCostLedger)
    private readonly ledger: Repository<AgentCostLedger>,
  ) {}

  /** Records one call and returns what it cost (0 when unpriced). */
  async record(line: AgentCostLine): Promise<number> {
    const input = line.usage?.inputTokens ?? 0;
    const output = line.usage?.outputTokens ?? 0;
    const cacheRead = line.usage?.cachedTokens ?? 0;
    const cacheWrite = line.usage?.cacheCreationTokens ?? 0;
    const { costUsd, priced } = computeCostUsd(line.model, input, output, {
      cacheReadTokens: cacheRead,
      cacheCreationTokens: cacheWrite,
    });
    if (!priced) {
      this.logger.warn(
        `No price for ${line.model}; recording ${line.agentKey}/${line.role} at $0`,
      );
    }
    try {
      await this.ledger.insert({
        agentKey: line.agentKey,
        role: line.role,
        provider: line.provider,
        model: line.model,
        promptTokens: input,
        completionTokens: output,
        cacheReadTokens: cacheRead,
        cacheCreationTokens: cacheWrite,
        usd: costUsd.toFixed(6),
        threadId: line.threadId ?? null,
        turnId: line.turnId ?? null,
        userId: line.userId ?? null,
        visitorId: line.visitorId ?? null,
        tenantId: line.tenantId ?? null,
      });
    } catch (error) {
      this.logger.warn(
        `Cost ledger write failed (${line.agentKey}/${line.role}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    return costUsd;
  }

  async totalForThread(agentKey: string, threadId: string): Promise<number> {
    return this.sum(`"agentKey" = $1 AND "threadId" = $2`, [
      agentKey,
      threadId,
    ]);
  }

  /**
   * Spend in a rolling window ending now. The window is computed in SQL
   * against `now()`, like `createdAt` itself, so the comparison never mixes
   * database time with this process's clock.
   */
  async totalForUserWithin(
    agentKey: string,
    userId: number,
    windowMs: number,
  ): Promise<number> {
    return this.sum(
      `"agentKey" = $1 AND "userId" = $2 AND "createdAt" >= now() - ($3::int * interval '1 millisecond')`,
      [agentKey, userId, windowMs],
    );
  }

  async totalForVisitorWithin(
    agentKey: string,
    visitorId: string,
    windowMs: number,
  ): Promise<number> {
    return this.sum(
      `"agentKey" = $1 AND "visitorId" = $2 AND "createdAt" >= now() - ($3::int * interval '1 millisecond')`,
      [agentKey, visitorId, windowMs],
    );
  }

  private async sum(where: string, params: unknown[]): Promise<number> {
    const rows: Array<{ total: string | null }> = await this.ledger.query(
      `SELECT COALESCE(SUM("usd"), 0) AS total FROM "agent_cost_ledger" WHERE ${where}`,
      params,
    );
    return Number(rows?.[0]?.total ?? 0);
  }
}
