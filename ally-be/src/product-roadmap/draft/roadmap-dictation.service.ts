import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { computeServiceCostUsd } from 'src/analytics/constants/llm-pricing.constants';
import { LlmUsageService } from 'src/analytics/service/llm-usage.service';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import { LoggerService } from 'src/logger/logger.service';
import { PlanStage } from 'src/product-planning/enum/product-planning.enum';
import { PlanCeilingService } from 'src/product-planning/service/plan-ceiling.service';
import { PlanSpendService } from 'src/product-planning/service/plan-spend.service';
import { RoadmapRoleService } from 'src/product-planning/service/roadmap-role.service';
import { roleAtLeast } from 'src/product-planning/util/roadmap-role.util';
import { RoadmapIdeaTranscriptionService } from '../service/roadmap-idea-transcription.service';
import { RoadmapItemReadService } from '../item/roadmap-item-read.service';
import { RoadmapDraftService } from './roadmap-draft.service';

/** D9: a clip stops at 2 minutes; a little grace for the recorder's own timing. */
export const DICTATION_MAX_MS = 120_000;
const DICTATION_GRACE_MS = 1_500;
/** Two minutes of any browser codec fits well inside this; the API's own cap is 25MB. */
export const DICTATION_MAX_BYTES = 10 * 1024 * 1024;
/** The AI task registry row this call runs under (spend ledger `taskId`). */
const DICTATION_TASK_ID = 'roadmap-dictation';
const PROVIDER = 'openai';

const coded = (status: HttpStatus, code: string, message: string) =>
  new HttpException({ statusCode: status, code, message }, status);

/**
 * Dictation (D9, §4.2, §5.7a): the one new model call in Roadmap v2. A short
 * clip from the mic on the draft page or an answer/comment box becomes
 * editable text; it is never sent anywhere on its own.
 *
 * Reuses the transcription path the scribe voice note uses (OpenAI, the
 * deployment's `OPENAI_TRANSCRIPTION_MODEL`, in memory only) through the idea
 * capture's existing service, rather than a second copy of it.
 *
 * Cost: a draft's clip counts against its $1 idea-stage cap and is refused
 * once the cap is reached (typing still works); a shared idea's counts
 * against its plan ceiling. Priced from the clip length at the STT table's
 * per-minute rate and written to the plan ledger and `llm_usage`.
 */
@Injectable()
export class RoadmapDictationService {
  private readonly logger = LoggerService.getInstance(
    RoadmapDictationService.name,
  );

  constructor(
    private readonly dataSource: DataSource,
    private readonly transcription: RoadmapIdeaTranscriptionService,
    private readonly drafts: RoadmapDraftService,
    private readonly reader: RoadmapItemReadService,
    private readonly roles: RoadmapRoleService,
    private readonly spend: PlanSpendService,
    private readonly ceiling: PlanCeilingService,
    private readonly llmUsage: LlmUsageService,
  ) {}

  async dictate(
    userId: number,
    input: {
      audio: Express.Multer.File | undefined;
      durationMs: number;
      code?: string;
    },
  ): Promise<{ text: string; durationMs: number }> {
    if (!input.audio?.buffer?.length) {
      throw new UnprocessableEntityException('No audio was sent.');
    }
    if (input.audio.size > DICTATION_MAX_BYTES) {
      throw coded(
        HttpStatus.PAYLOAD_TOO_LARGE,
        'clip_too_long',
        'That recording is too large. Clips stop at 2 minutes.',
      );
    }
    const durationMs = Math.round(Number(input.durationMs));
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      throw new UnprocessableEntityException('Say how long the clip is.');
    }
    if (durationMs > DICTATION_MAX_MS + DICTATION_GRACE_MS) {
      throw coded(
        HttpStatus.PAYLOAD_TOO_LARGE,
        'clip_too_long',
        'Clips stop at 2 minutes.',
      );
    }

    const target = await this.target(userId, input.code);

    let text: string;
    try {
      text = await this.transcription.transcribe(input.audio);
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() < 500) {
        throw error;
      }
      throw coded(
        HttpStatus.BAD_GATEWAY,
        'transcription_failed',
        "Couldn't transcribe. Try again.",
      );
    }

    const model = this.transcription.modelId;
    void this.llmUsage.record({
      service: 'stt',
      provider: PROVIDER,
      model,
      task: LlmTask.ROADMAP_DICTATION,
      audioMs: durationMs,
      metadata: {
        feature: 'roadmap-v2',
        userId,
        sessionId: target?.sessionId ?? null,
      },
    });
    if (target) {
      try {
        await this.spend.record({
          sessionId: target.sessionId,
          stage: target.stage,
          actorUserId: userId,
          specialist: null,
          taskId: DICTATION_TASK_ID,
          provider: PROVIDER,
          model,
          tokensIn: 0,
          tokensOut: 0,
          knownCostUsd: computeServiceCostUsd('stt', PROVIDER, model, {
            audioMs: durationMs,
          }).costUsd,
        });
      } catch (error) {
        // The words are already back; a ledger write must not lose them.
        this.logger.warn(
          `[ROADMAP_DICTATION] spend not recorded: ${(error as Error)?.message}`,
        );
      }
    }
    return { text, durationMs };
  }

  /**
   * Where the clip's cost lands, after checking the caller may write there.
   * No code: a mic with nothing to charge yet (still role-checked).
   */
  private async target(
    userId: number,
    code: string | undefined,
  ): Promise<{ sessionId: string; stage: PlanStage | null } | null> {
    if (!code) {
      if (!roleAtLeast(await this.roles.roleOf(userId), 'idea')) {
        throw new ForbiddenException(
          'Dictation needs the Idea role on the Roadmap.',
        );
      }
      return null;
    }

    const draft = await this.drafts.ownDraft(userId, code).catch(() => null);
    if (draft) {
      if (!roleAtLeast(await this.roles.roleOf(userId), 'idea')) {
        throw new ForbiddenException(
          'Dictation needs the Idea role on the Roadmap.',
        );
      }
      const cap = await this.spend.checkCeiling(draft.id, PlanStage.IDEA);
      if (cap.spentUsd >= cap.ceilingUsd) {
        throw coded(
          HttpStatus.CONFLICT,
          'idea_cap_reached',
          'This draft has used its assistant allowance. Typing still works.',
        );
      }
      return { sessionId: draft.id, stage: PlanStage.IDEA };
    }

    // A shared idea: the mic sits on an answer or comment box.
    const item = await this.reader.detail(userId, code);
    if (!item.can.answer && !item.can.comment) {
      throw new ForbiddenException('You cannot write on this idea.');
    }
    if (!item.sessionId) return null;
    await this.ceiling.assertWithinCeiling(item.sessionId, 'dictation');
    const [row] = await this.dataSource.query(
      `SELECT "planStage" FROM "builder_sessions" WHERE id = $1`,
      [item.sessionId],
    );
    return {
      sessionId: item.sessionId,
      stage: (row?.planStage as PlanStage | null) ?? null,
    };
  }
}
