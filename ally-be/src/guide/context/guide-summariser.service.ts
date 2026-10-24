import { Injectable } from '@nestjs/common';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import { LoggerService } from 'src/logger/logger.service';
import { GUIDE_AI_TASKS } from '../constants/guide-ai-tasks.constants';
import { GuideMessage } from '../entity/guide-message.entity';
import { GuideMessageKind, GuideMessageRole } from '../enum/guide.enum';
import {
  SUMMARISER_OUTPUT_SCHEMA,
  SUMMARISER_SYSTEM_PROMPT,
  SummaryLine,
  buildSummariserUserMessage,
  renderSummary,
} from '../prompts/summariser.prompt';
import { GuideReleaseBundle } from '../release/guide-release.bundle';
import {
  GuideCallAttribution,
  GuideModelService,
} from '../runtime/guide-model.service';

/** One line of the transcript, at most this long, for the summariser. */
const LINE_MAX_CHARS = 600;
/** The transcript given to the summariser, newest kept when longer. */
const TRANSCRIPT_MAX_CHARS = 60_000;
const SUMMARISER_TIMEOUT_MS = 20_000;

export const LEFT_OUT_REAL_CASE =
  '[the learner described a real situation; details left out]';
export const LEFT_OUT_HARD_MOMENT = '[a hard moment; handled at the time]';

type TranscriptRow = Pick<
  GuideMessage,
  'seq' | 'role' | 'kind' | 'content' | 'turnId' | 'flags'
>;

/**
 * The epoch as the summariser reads it: what the learner and Ally said,
 * with a real case or identifying details replaced whole (and Ally's reply
 * to it), and a hard moment reduced to a marker — mode and crisis state
 * are kept by the thread, not by a summary. Platform notes stay as notes.
 * The oldest lines go first when the whole is too long; the earlier summary
 * already covers them.
 */
export function summariserTranscript(rows: TranscriptRow[]): SummaryLine[] {
  const ordered = [...rows].sort((a, b) => a.seq - b.seq);
  const privateTurns = new Set(
    ordered
      .filter((row) => (row.flags?.realCase || row.flags?.pii) && row.turnId)
      .map((row) => row.turnId as string),
  );
  const hardTurns = new Set(
    ordered
      .filter((row) => (row.flags?.crisis || row.flags?.care) && row.turnId)
      .map((row) => row.turnId as string),
  );
  const lines: SummaryLine[] = [];
  for (const row of ordered) {
    const text = row.content?.trim();
    if (!text) continue;
    const turn = row.turnId ?? '';
    if (row.role === GuideMessageRole.SYSTEM_NOTE) {
      lines.push({ role: 'note', text: clip(text) });
    } else if (row.role === GuideMessageRole.LEARNER) {
      lines.push({
        role: 'learner',
        text: privateTurns.has(turn)
          ? LEFT_OUT_REAL_CASE
          : hardTurns.has(turn)
            ? LEFT_OUT_HARD_MOMENT
            : clip(text),
      });
    } else if (row.role === GuideMessageRole.ALLY) {
      if (privateTurns.has(turn) || hardTurns.has(turn)) continue;
      if (row.kind === GuideMessageKind.CRISIS_FIXED) continue;
      lines.push({ role: 'ally', text: clip(text) });
    }
  }
  let total = lines.reduce((sum, line) => sum + line.text.length, 0);
  while (lines.length > 1 && total > TRANSCRIPT_MAX_CHARS) {
    total -= lines.shift()!.text.length;
  }
  return lines;
}

const clip = (text: string) =>
  text.length > LINE_MAX_CHARS ? `${text.slice(0, LINE_MAX_CHARS - 1)}…` : text;

/**
 * The summariser role (plans/ally-guide/plan.md §7.6, §7.7): condenses an
 * epoch that grew past `history.summariseAboveTokens` into the structured
 * summary the next epoch's opener carries. A failure returns null and the
 * new epoch opens with the last few messages only — the conversation goes
 * on either way.
 */
@Injectable()
export class GuideSummariserService {
  private readonly logger = LoggerService.getInstance(
    GuideSummariserService.name,
  );

  constructor(private readonly models: GuideModelService) {}

  async summarise(input: {
    rows: TranscriptRow[];
    previousSummary: string | null;
    courseTitle: string;
    bundle: GuideReleaseBundle;
    attribution: GuideCallAttribution;
    onCost?: (usd: number) => void;
  }): Promise<string | null> {
    const lines = summariserTranscript(input.rows);
    if (!lines.length) return input.previousSummary;
    try {
      const { result } = await this.models.complete({
        role: 'summariser',
        bundle: input.bundle,
        task: LlmTask.GUIDE_SUMMARISER,
        aiTaskId: GUIDE_AI_TASKS.SUMMARISER,
        attribution: input.attribution,
        onCost: input.onCost,
        request: {
          system: [
            {
              text:
                input.bundle.prompts.summariser?.text ??
                SUMMARISER_SYSTEM_PROMPT,
              cache: true,
            },
          ],
          messages: [
            {
              role: 'user',
              content: buildSummariserUserMessage({
                previousSummary: input.previousSummary,
                courseTitle: input.courseTitle,
                lines,
              }),
            },
          ],
          maxTokens: 3_000,
          outputSchema: SUMMARISER_OUTPUT_SCHEMA as unknown as Record<
            string,
            unknown
          >,
          timeoutMs: SUMMARISER_TIMEOUT_MS,
        },
      });
      if (result.stopReason !== 'end_turn') {
        this.logger.warn(`Summariser stopped with ${result.stopReason}`);
        return input.previousSummary;
      }
      const text = result.content
        .filter((block) => block.type === 'text')
        .map((block) => (block as { text: string }).text)
        .join('');
      return renderSummary(JSON.parse(text)) ?? input.previousSummary;
    } catch (error) {
      this.logger.warn(`Summariser failed: ${String(error)}`);
      return input.previousSummary;
    }
  }
}
