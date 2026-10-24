import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppConfigService } from 'src/config/config.service';
import { LoggerService } from 'src/logger/logger.service';
import { S3Service } from 'src/aws/service/s3.service';
import { AgentTurnTrace } from 'src/llm-agent/entity/agent-turn-trace.entity';

export interface WriteTraceInput {
  turnId: string;
  agentKey: string;
  threadId: string;
  releaseId?: string | null;
  tenantId?: string | null;
  /** Small and admin-readable: stage timings, guard verdicts, usage, reasons. */
  summary: Record<string, unknown>;
  /** Large and sensitive: rendered prompt, tool I/O. Goes to S3, never Postgres. */
  payload?: Record<string, unknown>;
}

/**
 * Product-level turn traces (plans/ally-guide/plan.md §7.12) — what the admin
 * Turn Inspector reads. Writing a trace NEVER fails a turn: every error is
 * logged and swallowed. Payloads go to a PRIVATE bucket
 * (AGENT_TRACE_S3_BUCKET, else the audio bucket) under `agent-traces/`; with
 * neither configured the summary is still written and the payload dropped.
 */
@Injectable()
export class AgentTraceService {
  private readonly logger = LoggerService.getInstance(AgentTraceService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly s3Service: S3Service,
    private readonly config: AppConfigService,
  ) {}

  private get traces() {
    return this.dataSource.getRepository(AgentTurnTrace);
  }

  private get bucket(): string | undefined {
    return (
      this.config.s3?.agentTraceBucket ||
      this.config.s3?.audioBucket ||
      undefined
    );
  }

  /** `agent-traces/<agent>/<yyyy>/<mm>/<turnId>.json` — a lifecycle rule expires the prefix. */
  static payloadKey(agentKey: string, turnId: string, at = new Date()): string {
    const yyyy = at.getUTCFullYear();
    const mm = String(at.getUTCMonth() + 1).padStart(2, '0');
    return `agent-traces/${agentKey}/${yyyy}/${mm}/${turnId}.json`;
  }

  async write(input: WriteTraceInput): Promise<void> {
    let payloadKey: string | null = null;
    if (input.payload && this.bucket) {
      const key = AgentTraceService.payloadKey(input.agentKey, input.turnId);
      try {
        await this.s3Service.uploadStream({
          Bucket: this.bucket,
          Key: key,
          Body: JSON.stringify(input.payload),
          ContentType: 'application/json',
          ServerSideEncryption: 'AES256',
        });
        payloadKey = key;
      } catch (error) {
        this.logger.warn(
          `Trace payload upload failed for turn ${input.turnId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    try {
      await this.traces.save(
        this.traces.create({
          turnId: input.turnId,
          agentKey: input.agentKey,
          threadId: input.threadId,
          releaseId: input.releaseId ?? null,
          tenantId: input.tenantId ?? null,
          summary: input.summary,
          payloadKey,
        }),
      );
    } catch (error) {
      this.logger.warn(
        `Trace write failed for turn ${input.turnId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * The full trace payload for a turn, or null when none was stored. It holds
   * learner text, so callers gate it behind the transcripts permission.
   */
  async getPayload(turnId: string): Promise<Record<string, unknown> | null> {
    const trace = await this.getByTurn(turnId);
    if (!trace?.payloadKey || !this.bucket) return null;
    try {
      const buffer = await this.s3Service.getObjectBuffer({
        bucket: this.bucket,
        key: trace.payloadKey,
      });
      return JSON.parse(buffer.toString('utf8')) as Record<string, unknown>;
    } catch (error) {
      this.logger.warn(
        `Trace payload read failed for turn ${turnId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  getByTurn(turnId: string): Promise<AgentTurnTrace | null> {
    return this.traces.findOne({ where: { turnId } });
  }

  listByThread(threadId: string, limit = 50): Promise<AgentTurnTrace[]> {
    return this.traces.find({
      where: { threadId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }
}
