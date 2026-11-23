import { Injectable, Optional } from '@nestjs/common';
import { AiService } from '../../ai/service/ai.service';
import { usageContext } from '../../billing/context/usage-context';
import { UsageChannel, UsageKind } from '../../billing/enum/billing.enum';
import { LoggerService } from '../../logger/logger.service';
import { CrisisSuiteService } from '../checkup/crisis-suite.service';
import {
  CHECK_UNAVAILABLE_MESSAGE,
  SAFETY_CONFLICT_MESSAGE,
} from '../home/assistant-home.service';
import { BASE_SAFETY_RULES, packFor } from '../safety-pack/safety-packs';
import {
  InstructionSafetyApplyCheck,
  type SafetyApplyCheck,
  type SafetyApplyInput,
  type SafetyApplyResult,
} from './safety-apply-check';

/** Owner-written text the judge reads (the same set the first pass reads). */
const JUDGED_FIELDS = new Set([
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

const asList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter(
        (v): v is string => typeof v === 'string' && Boolean(v.trim()),
      )
    : [];

// COPY: needs approval
export const LANGUAGE_CHECK_FAILED =
  "The crisis check didn't pass in {languages}, so it can't be turned on. Remove it, or contact Ally.";

/** The fixed rules the judge reads owner text against (stage 4, plan section 3). */
export function applySafetyRules(safetyPackId: string | null): string[] {
  // The minors lines are left out: an adults-only assistant may rightly ask for a phone number to
  // book, and the runtime block already adds them whenever the audience is not adults only.
  return [...BASE_SAFETY_RULES, ...(packFor(safetyPackId)?.rules ?? [])];
}

/**
 * Stage 4's Apply safety check, bound to `SAFETY_APPLY_CHECK`. Runs only for the safety-relevant
 * changes the working copy sends (name, greeting and suggested questions never reach it), and fails
 * closed at every step:
 *  1. the first pass, unchanged: the instruction patterns (`InstructionSafetyApplyCheck`,
 *     `AiService.checkOwnerText`, no model);
 *  2. a model judge on each changed owner text against the fixed rule list
 *     (`AiService.judgeOwnerText`, task `apply_safety_judge`), with its reason in English and Hindi;
 *  3. a newly enabled language must pass the crisis suite (`CrisisSuiteService`).
 * Metered to the builder's free balance (the working copy refuses safety-relevant changes at $0).
 */
@Injectable()
export class JudgedSafetyApplyCheck implements SafetyApplyCheck {
  private readonly logger = LoggerService.getInstance(
    JudgedSafetyApplyCheck.name,
  );
  private readonly firstPass: InstructionSafetyApplyCheck;

  constructor(
    @Optional() private readonly ai?: AiService,
    @Optional() private readonly crisisSuite?: CrisisSuiteService,
  ) {
    this.firstPass = new InstructionSafetyApplyCheck(ai);
  }

  async check(input: SafetyApplyInput): Promise<SafetyApplyResult> {
    const first = await this.firstPass.check(input);
    if (!first.ok) return first;

    const rules = applySafetyRules(input.safetyPackId);
    for (const change of input.changes) {
      if (!JUDGED_FIELDS.has(change.field)) continue;
      const text = asText(change.working).trim();
      if (!text) continue;
      let verdict: Awaited<ReturnType<AiService['judgeOwnerText']>> | null =
        null;
      try {
        verdict = this.ai
          ? await usageContext.run(
              {
                channel: UsageChannel.OWNER,
                runKind: UsageKind.INSTRUCTIONS,
                chatbotId: input.chatbotId,
                draftId: input.draftId,
                creatorUserId: input.builderUserId,
              },
              () => this.ai!.judgeOwnerText(text, rules),
            )
          : null;
      } catch (error) {
        this.logger.warn(
          `Apply judge unavailable for chatbot ${input.chatbotId} (${change.field}): ${
            error instanceof Error ? error.message : 'unknown'
          }`,
        );
      }
      if (!verdict || verdict.failed) {
        return {
          ok: false,
          errorCode: 'check_unavailable',
          field: change.field,
          message: CHECK_UNAVAILABLE_MESSAGE,
        };
      }
      if (verdict.conflict) {
        const reasons = [verdict.reason_en, verdict.reason_hi]
          .map((r) => r?.trim())
          .filter(Boolean);
        return {
          ok: false,
          errorCode: 'safety_conflict',
          field: change.field,
          message: reasons.length
            ? reasons.join('\n')
            : SAFETY_CONFLICT_MESSAGE,
        };
      }
    }

    const languages = input.changes.find((c) => c.field === 'languages');
    if (languages) {
      const before = new Set(
        asList(languages.live).map((l) => l.toLowerCase()),
      );
      const added = asList(languages.working).filter(
        (l) => !before.has(l.toLowerCase()),
      );
      if (added.length) {
        if (!this.crisisSuite) {
          return {
            ok: false,
            errorCode: 'check_unavailable',
            field: 'languages',
            message: CHECK_UNAVAILABLE_MESSAGE,
          };
        }
        let results: Awaited<ReturnType<CrisisSuiteService['run']>>;
        try {
          results = await this.crisisSuite.run(input.chatbotId, added, {
            // Apply refuses instead: turning a language off here would be undone by the write.
            turnOff: false,
            assertAccess: false,
          });
        } catch (error) {
          this.logger.warn(
            `Apply crisis check unavailable for chatbot ${input.chatbotId}: ${
              error instanceof Error ? error.message : 'unknown'
            }`,
          );
          return {
            ok: false,
            errorCode: 'check_unavailable',
            field: 'languages',
            message: CHECK_UNAVAILABLE_MESSAGE,
          };
        }
        if (results.some((r) => r.status === 'error')) {
          return {
            ok: false,
            errorCode: 'check_unavailable',
            field: 'languages',
            message: CHECK_UNAVAILABLE_MESSAGE,
          };
        }
        const failing = results.filter((r) => r.status !== 'pass');
        if (failing.length) {
          return {
            ok: false,
            errorCode: 'safety_conflict',
            field: 'languages',
            message: LANGUAGE_CHECK_FAILED.replace(
              '{languages}',
              failing.map((r) => r.language).join(', '),
            ),
          };
        }
      }
    }
    return first;
  }
}
