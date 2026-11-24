import { Injectable, Optional } from '@nestjs/common';
import { AiService } from '../../ai/service/ai.service';
import { usageContext } from '../../billing/context/usage-context';
import { UsageChannel, UsageKind } from '../../billing/enum/billing.enum';
import { LoggerService } from '../../logger/logger.service';
import {
  CHECK_UNAVAILABLE_MESSAGE,
  SAFETY_CONFLICT_MESSAGE,
} from '../home/assistant-home.service';

/** One staged change Apply is about to publish. */
export interface SafetyApplyChange {
  field: string;
  live: unknown;
  working: unknown;
}

export interface SafetyApplyInput {
  chatbotId: string;
  draftId: string;
  /** Who pays for the check's model call (the chatbot's builder). */
  builderUserId: number | null;
  safetyPackId: string | null;
  /** Only the safety-relevant changes: the caller never sends name, greeting or questions. */
  changes: SafetyApplyChange[];
}

export type SafetyApplyResult =
  | { ok: true; warnings: { field: string; message: string }[] }
  | {
      ok: false;
      /** `safety_conflict`: the text weakens a safety rule. `check_unavailable`: not checked. */
      errorCode: 'safety_conflict' | 'check_unavailable';
      field: string;
      message: string;
    };

/**
 * The check Apply runs before staged changes reach customers (R3; plan section 3 "Apply and AI
 * cost"). Pluggable: stage 4 adds the crisis check in every enabled language and a model judge
 * behind this same interface. Every implementation must fail closed: anything it could not check
 * is refused, never published.
 */
export interface SafetyApplyCheck {
  check(input: SafetyApplyInput): Promise<SafetyApplyResult>;
}

export const SAFETY_APPLY_CHECK = 'BOT_DRAFT_SAFETY_APPLY_CHECK';

/** Text an owner typed that the instruction check reads. */
const TEXT_FIELDS = new Set([
  'instructions',
  'tone',
  'assistantName',
  'declineText',
  'extraNever',
  'ownerNotes',
]);

const asText = (value: unknown): string =>
  Array.isArray(value)
    ? value.map((v) => String(v ?? '')).join('\n')
    : typeof value === 'string'
      ? value
      : '';

/**
 * Today's check: the same instruction check the assistant home runs on "Your instructions"
 * (`AiService.checkOwnerText`, ally-ai `/agent/instructions/check`), on every owner-written text
 * that changed. One model call per changed text, metered to the builder as `instructions`.
 *
 * Fails closed: no AI service, an error, or an empty answer refuses the whole Apply.
 *
 * Languages and new sources pass through here without a model call for now: the per-language
 * crisis gate is stage 4 and the personal-data scan of new documents is stage 5, both behind this
 * interface. They are still safety-relevant, so they wait for Apply and are refused at $0.
 */
@Injectable()
export class InstructionSafetyApplyCheck implements SafetyApplyCheck {
  private readonly logger = LoggerService.getInstance(
    InstructionSafetyApplyCheck.name,
  );

  constructor(@Optional() private readonly ai?: AiService) {}

  async check(input: SafetyApplyInput): Promise<SafetyApplyResult> {
    const warnings: { field: string; message: string }[] = [];
    for (const change of input.changes) {
      if (!TEXT_FIELDS.has(change.field)) continue;
      const text = asText(change.working).trim();
      if (!text) continue; // clearing a text adds nothing to check
      let result: { refused: string | null; warning: string | null } | null;
      try {
        result = this.ai
          ? await usageContext.run(
              {
                channel: UsageChannel.OWNER,
                runKind: UsageKind.INSTRUCTIONS,
                chatbotId: input.chatbotId,
                draftId: input.draftId,
                creatorUserId: input.builderUserId,
              },
              () => this.ai!.checkOwnerText(text),
            )
          : null;
      } catch (error) {
        this.logger.warn(
          `Apply check unavailable for chatbot ${input.chatbotId} (${change.field}): ${
            error instanceof Error ? error.message : 'unknown'
          }`,
        );
        result = null;
      }
      if (!result) {
        return {
          ok: false,
          errorCode: 'check_unavailable',
          field: change.field,
          message: CHECK_UNAVAILABLE_MESSAGE,
        };
      }
      if (result.refused) {
        return {
          ok: false,
          errorCode: 'safety_conflict',
          field: change.field,
          message: SAFETY_CONFLICT_MESSAGE,
        };
      }
      if (result.warning) {
        warnings.push({ field: change.field, message: result.warning });
      }
    }
    return { ok: true, warnings };
  }
}
