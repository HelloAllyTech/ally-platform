import { Injectable } from '@nestjs/common';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import {
  COURSE_COPILOT_AI_TASKS,
  COURSE_COPILOT_PROMPTS,
} from '../../constants/course-copilot.constants';
import { AnalysisSignal } from '../../util/course-pilot-analysis.util';
import { SpecialistLlmService } from './specialist-llm.service';
import {
  asArray,
  asText,
  isRecord,
  SPECIALIST_MAX_TOKENS,
} from './specialist.util';

export const COURSE_ANALYST_MAX_SUGGESTIONS = 6;
export const COURSE_ANALYST_KINDS = [
  'reword',
  'rule',
  'shorten',
  'add',
  'check_key',
] as const;
export type CourseAnalystKind = (typeof COURSE_ANALYST_KINDS)[number];

export interface CourseAnalystSuggestion {
  itemId?: string;
  signal: string;
  cause: string;
  change: string;
  kind: CourseAnalystKind;
}

export interface CourseAnalystResult {
  summary: string;
  suggestions: CourseAnalystSuggestion[];
}

/**
 * Course Pilot's Analyst (Improve stage): turns the signals code found in a published course's
 * group numbers into edits a trainer can approve. It never sees a learner, and never edits: the
 * trainer picks, the Interviewer applies with the edit tools.
 */
@Injectable()
export class CourseAnalystSpecialist {
  constructor(private readonly llm: SpecialistLlmService) {}

  async analyse(input: {
    outline: string;
    /** CourseCopilotLearnerResultsService.render: the organisation's group numbers, in words. */
    results: string;
    itemIds: string[];
    signals: AnalysisSignal[];
    usageMetadata?: Record<string, any>;
  }): Promise<CourseAnalystResult> {
    const { data } = await this.llm.runJson({
      specialist: 'course_analyst',
      promptCode: COURSE_COPILOT_PROMPTS.COURSE_ANALYST,
      taskId: COURSE_COPILOT_AI_TASKS.COURSE_ANALYST,
      task: LlmTask.COURSE_COPILOT_COURSE_ANALYST,
      maxTokens: SPECIALIST_MAX_TOKENS.COURSE_ANALYST,
      usageMetadata: input.usageMetadata ?? {},
      variables: {
        course_outline: input.outline,
        learner_facts: input.results,
        signals: input.signals.map((s) => `- ${s.text}`).join('\n'),
        max_suggestions: String(COURSE_ANALYST_MAX_SUGGESTIONS),
      },
    });
    return normaliseAnalystResult(data, input.itemIds);
  }
}

/** Pure: raw model JSON → suggestions; an itemId the course does not hold is dropped. */
export function normaliseAnalystResult(
  raw: Record<string, any>,
  itemIds: string[],
): CourseAnalystResult {
  const ids = new Set(itemIds);
  const suggestions: CourseAnalystSuggestion[] = [];
  for (const rawSuggestion of asArray(raw?.suggestions).filter(isRecord)) {
    const change = asText(rawSuggestion.change, 400);
    if (!change) continue;
    const kindText = asText(rawSuggestion.kind).toLowerCase();
    const suggestion: CourseAnalystSuggestion = {
      signal: asText(rawSuggestion.signal, 200),
      cause: asText(rawSuggestion.cause, 400),
      change,
      kind: (COURSE_ANALYST_KINDS as readonly string[]).includes(kindText)
        ? (kindText as CourseAnalystKind)
        : 'reword',
    };
    const itemId = asText(rawSuggestion.itemId);
    if (itemId && ids.has(itemId)) suggestion.itemId = itemId;
    suggestions.push(suggestion);
    if (suggestions.length >= COURSE_ANALYST_MAX_SUGGESTIONS) break;
  }
  return { summary: asText(raw?.summary, 600), suggestions };
}
