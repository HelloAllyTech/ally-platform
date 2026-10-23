import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AgentTurn } from 'src/llm-agent/entity/agent-turn.entity';
import {
  AgentChannel,
  AgentTurnStatus,
  AgentTurnTrigger,
} from '../enum/harness.enum';

/** On Postgres an `INSERT … RETURNING` through `query()` can come back as `[rows, count]`. */
function returningRows<T>(result: unknown): T[] {
  const value = result as unknown[];
  return (Array.isArray(value?.[0]) ? value[0] : value) as T[];
}

export interface CreateTurnInput {
  agentKey: string;
  threadId: string;
  clientTurnId?: string | null;
  trigger: AgentTurnTrigger;
  channel?: AgentChannel;
  releaseId?: string | null;
  arm?: string | null;
  tenantId?: string | null;
}

/**
 * The turn state machine's storage (plans/ally-guide/plan.md §7.3).
 * `createOrGet` is the idempotency point: a resent request with the same
 * `(threadId, clientTurnId)` gets the existing turn back, never a second run.
 */
@Injectable()
export class AgentTurnStoreService {
  constructor(private readonly dataSource: DataSource) {}

  private get turns() {
    return this.dataSource.getRepository(AgentTurn);
  }

  async createOrGet(
    input: CreateTurnInput,
  ): Promise<{ turn: AgentTurn; created: boolean }> {
    if (input.clientTurnId) {
      const inserted = returningRows<AgentTurn>(
        await this.dataSource.query(
          `INSERT INTO "agent_turns"
             ("agentKey", "threadId", "clientTurnId", "trigger", "channel",
              "status", "releaseId", "arm", "tenant_id")
           VALUES ($1, $2, $3, $4, $5, 'received', $6, $7, $8)
           ON CONFLICT ("threadId", "clientTurnId") WHERE "clientTurnId" IS NOT NULL
           DO NOTHING
           RETURNING *`,
          [
            input.agentKey,
            input.threadId,
            input.clientTurnId,
            input.trigger,
            input.channel ?? AgentChannel.TEXT,
            input.releaseId ?? null,
            input.arm ?? null,
            input.tenantId ?? null,
          ],
        ),
      );
      if (inserted.length) {
        return { turn: this.turns.create(inserted[0]), created: true };
      }
      const existing = await this.turns.findOne({
        where: { threadId: input.threadId, clientTurnId: input.clientTurnId },
      });
      if (existing) return { turn: existing, created: false };
    }
    const turn = await this.turns.save(
      this.turns.create({
        agentKey: input.agentKey,
        threadId: input.threadId,
        clientTurnId: input.clientTurnId ?? null,
        trigger: input.trigger,
        channel: input.channel ?? AgentChannel.TEXT,
        status: AgentTurnStatus.RECEIVED,
        releaseId: input.releaseId ?? null,
        arm: input.arm ?? null,
        tenantId: input.tenantId ?? null,
      }),
    );
    return { turn, created: true };
  }

  async transition(
    turnId: string,
    status: AgentTurnStatus,
    patch: Partial<
      Pick<AgentTurn, 'startedAt' | 'releaseId' | 'arm' | 'ttftMs'>
    > = {},
  ): Promise<void> {
    await this.turns.update(turnId, { status, ...patch });
  }

  async finish(
    turnId: string,
    result: {
      status:
        | AgentTurnStatus.COMPLETED
        | AgentTurnStatus.FAILED
        | AgentTurnStatus.CANCELLED
        | AgentTurnStatus.INTERRUPTED;
      errorCode?: string | null;
      ttftMs?: number | null;
      durationMs: number;
      costUsd?: number;
    },
  ): Promise<void> {
    await this.turns.update(turnId, {
      status: result.status,
      errorCode: result.errorCode ?? null,
      ttftMs: result.ttftMs ?? null,
      durationMs: result.durationMs,
      costUsd: (result.costUsd ?? 0).toFixed(6),
      completedAt: new Date(),
    });
  }

  findById(turnId: string): Promise<AgentTurn | null> {
    return this.turns.findOne({ where: { id: turnId } });
  }

  /**
   * Turns left open by a crash or deploy (plan §7.10): marked INTERRUPTED so
   * the next turn on that thread is not blocked and the learner can retry.
   */
  async markStaleOpenTurnsInterrupted(olderThanMs: number): Promise<number> {
    const result = await this.dataSource.query(
      `UPDATE "agent_turns"
          SET "status" = 'interrupted', "errorCode" = 'interrupted',
              "completedAt" = now(), "updatedAt" = now()
        WHERE "status" IN ('received', 'admitted', 'streaming', 'tool_wait')
          AND "updatedAt" < now() - ($1::int * interval '1 millisecond')`,
      [olderThanMs],
    );
    return Array.isArray(result) && typeof result[1] === 'number'
      ? result[1]
      : 0;
  }
}
