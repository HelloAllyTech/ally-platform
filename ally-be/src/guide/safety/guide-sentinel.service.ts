import { Injectable } from '@nestjs/common';
import { matchFirstPersonRisk } from 'src/common/safety/first-person-risk.matcher';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import { LoggerService } from 'src/logger/logger.service';
import { GUIDE_AI_TASKS } from '../constants/guide-ai-tasks.constants';
import {
  SENTINEL_OUTPUT_SCHEMA,
  SENTINEL_SYSTEM_PROMPT,
  SentinelItemContext,
  SentinelTurn,
  buildSentinelUserMessage,
} from '../prompts/sentinel.prompt';
import { GuideReleaseBundle } from '../release/guide-release.bundle';
import {
  GuideCallAttribution,
  GuideModelService,
} from '../runtime/guide-model.service';
import {
  CLEAR_VERDICT,
  SentinelAbout,
  SentinelClassification,
  SentinelOverlay,
  SentinelRisk,
  SentinelVerdict,
  keywordVerdict,
} from './sentinel';

/**
 * A hard ceiling on the classifier call itself. The turn waits for the
 * verdict only up to the release's `safety.sentinelDeadlineMs`; past that the
 * reply is released on the keyword layer alone, and a verdict that lands
 * later is still applied (a late crisis still gets the fixed response).
 */
export const SENTINEL_HARD_TIMEOUT_MS = 8_000;

/** Room for adaptive thinking plus a few dozen tokens of JSON. */
const SENTINEL_MAX_TOKENS = 1_024;

const RISKS: SentinelRisk[] = ['none', 'care', 'crisis'];
const ABOUTS: SentinelAbout[] = [
  'self',
  'client',
  'course',
  'other',
  'unclear',
];
const OVERLAYS: SentinelOverlay[] = [
  'none',
  'real_case',
  'real_case_urgent',
  'pii',
];

/**
 * Parse the classifier's JSON, refusing anything outside the closed schema
 * rather than guessing what a malformed field meant.
 */
export function parseClassification(text: string): SentinelClassification {
  const raw = JSON.parse(text) as Record<string, unknown>;
  const pick = <T extends string>(value: unknown, allowed: T[]): T => {
    if (typeof value !== 'string' || !allowed.includes(value as T)) {
      throw new Error(`unexpected value ${JSON.stringify(value)}`);
    }
    return value as T;
  };
  const confidence = Number(raw.confidence);
  return {
    risk: pick(raw.risk, RISKS),
    about: pick(raw.about, ABOUTS),
    overlay: pick(raw.overlay, OVERLAYS),
    confidence: Number.isFinite(confidence)
      ? Math.min(1, Math.max(0, confidence))
      : 0,
    evidence:
      typeof raw.evidence === 'string' ? raw.evidence.slice(0, 200) : '',
  };
}

export interface SentinelInput {
  text: string;
  recentTurns: SentinelTurn[];
  item: SentinelItemContext | null;
  bundle: GuideReleaseBundle;
  attribution: GuideCallAttribution;
}

/**
 * The Sentinel (plans/ally-guide/plan.md §6.2): layer 1 is the first-person
 * keyword match, synchronous and terminal; layer 2 is a context-aware
 * classifier that tells the learner's own state from what they are
 * discussing. Never throws: a classifier failure is a verdict with
 * `source: 'error'`, and the keyword layer is what still holds.
 */
@Injectable()
export class GuideSentinelService {
  private readonly logger = LoggerService.getInstance(
    GuideSentinelService.name,
  );

  constructor(private readonly models: GuideModelService) {}

  /** Layer 1 only — for the paths that must not wait on a model. */
  keyword(text: string): SentinelVerdict | null {
    const startedAt = Date.now();
    const match = matchFirstPersonRisk(text);
    return match ? keywordVerdict(match, Date.now() - startedAt) : null;
  }

  async assess(input: SentinelInput): Promise<SentinelVerdict> {
    const hit = this.keyword(input.text);
    if (hit) return hit;

    const startedAt = Date.now();
    try {
      const { result, route } = await this.models.complete({
        role: 'sentinel',
        bundle: input.bundle,
        task: LlmTask.GUIDE_SENTINEL,
        aiTaskId: GUIDE_AI_TASKS.SENTINEL,
        attribution: input.attribution,
        request: {
          system: [
            {
              text:
                input.bundle.prompts.sentinel?.text ?? SENTINEL_SYSTEM_PROMPT,
              cache: true,
            },
          ],
          messages: [
            {
              role: 'user',
              content: buildSentinelUserMessage({
                message: input.text,
                recentTurns: input.recentTurns,
                item: input.item,
              }),
            },
          ],
          maxTokens: SENTINEL_MAX_TOKENS,
          outputSchema: SENTINEL_OUTPUT_SCHEMA as unknown as Record<
            string,
            unknown
          >,
          timeoutMs: SENTINEL_HARD_TIMEOUT_MS,
        },
      });
      const latencyMs = Date.now() - startedAt;
      if (result.stopReason !== 'end_turn') {
        this.logger.warn(
          `Sentinel stopped with ${result.stopReason}` +
            (result.stopDetails?.category
              ? ` (${result.stopDetails.category})`
              : ''),
        );
        return this.failed('error', latencyMs, route.model);
      }
      const text = result.content
        .filter((block) => block.type === 'text')
        .map((block) => (block as { text: string }).text)
        .join('');
      return {
        ...parseClassification(text),
        source: 'classifier',
        latencyMs,
        model: route.model,
      };
    } catch (error) {
      const latencyMs = Date.now() - startedAt;
      const timedOut =
        error instanceof Error && /timed? ?out|timeout/i.test(error.message);
      this.logger.warn(
        `Sentinel classifier ${timedOut ? 'timed out' : 'failed'}: ${
          error instanceof Error
            ? `${error.name}: ${error.message.slice(0, 300)}`
            : 'unknown'
        }`,
      );
      return this.failed(timedOut ? 'timeout' : 'error', latencyMs);
    }
  }

  private failed(
    source: 'timeout' | 'error',
    latencyMs: number,
    model?: string,
  ): SentinelVerdict {
    return { ...CLEAR_VERDICT, source, latencyMs, model };
  }
}
