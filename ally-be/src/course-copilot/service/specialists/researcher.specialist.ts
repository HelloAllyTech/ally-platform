import { Injectable } from '@nestjs/common';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import {
  COURSE_COPILOT_AI_TASKS,
  COURSE_COPILOT_PROMPTS,
} from '../../constants/course-copilot.constants';
import { CourseBrief } from '../../type/course-copilot.type';
import { SpecialistLlmService } from './specialist-llm.service';
import {
  asArray,
  asText,
  briefForPrompt,
  isRecord,
  SPECIALIST_MAX_TOKENS,
} from './specialist.util';

/**
 * Course Pilot's Researcher (plan §3, "knowledge per stage"): builds a short knowledge pack for
 * the conductor's question from what the current stage may read — the trainer's files, Learning
 * Design principles, learner profiles, example courses, learner results — with a citation on
 * every point. It never talks to the trainer and never writes content or decides; the
 * conductor does.
 *
 * Code gathers the snippets (the tools service, from the stage's knowledge list); this condenses
 * them. A point citing anything not in the snippets is dropped: an invented citation is worse
 * than a missing point.
 */

export interface ResearchSnippet {
  /** S1, S2… — what a point cites. */
  id: string;
  /** Where it came from, as the trainer would recognise it ("Design principle FP-0142"). */
  source: string;
  text: string;
}

export interface ResearchPoint {
  text: string;
  /** The sources' names, from the cited snippet ids. */
  sources: string[];
}

export interface ResearchPack {
  summary: string;
  points: ResearchPoint[];
  /** What the snippets did not answer. */
  gaps: string[];
}

const MAX_POINTS = 8;

@Injectable()
export class ResearcherSpecialist {
  constructor(private readonly llm: SpecialistLlmService) {}

  async condense(input: {
    question: string;
    stageTitle: string;
    brief: CourseBrief;
    snippets: ResearchSnippet[];
    usageMetadata?: Record<string, any>;
  }): Promise<ResearchPack> {
    if (!input.snippets.length) {
      return {
        summary: 'Nothing in this stage’s sources bears on the question.',
        points: [],
        gaps: [input.question],
      };
    }
    const { data } = await this.llm.runJson({
      specialist: 'researcher',
      promptCode: COURSE_COPILOT_PROMPTS.RESEARCHER,
      taskId: COURSE_COPILOT_AI_TASKS.RESEARCHER,
      task: LlmTask.COURSE_COPILOT_RESEARCHER,
      maxTokens: SPECIALIST_MAX_TOKENS.RESEARCHER,
      usageMetadata: input.usageMetadata ?? {},
      variables: {
        question: input.question,
        stage: input.stageTitle,
        brief_json: briefForPrompt(input.brief),
        snippets_json: JSON.stringify(input.snippets, null, 1),
        max_points: String(MAX_POINTS),
      },
    });
    return normaliseResearchPack(data, input.snippets);
  }
}

/** Pure: raw model JSON → a pack whose every point cites a snippet that was given. */
export function normaliseResearchPack(
  raw: unknown,
  snippets: ResearchSnippet[],
): ResearchPack {
  const root = isRecord(raw) ? raw : {};
  const byId = new Map(snippets.map((s) => [s.id.toUpperCase(), s.source]));
  const points: ResearchPoint[] = [];
  for (const entry of asArray(root.points).filter(isRecord)) {
    const text = asText(entry.text, 400);
    const cited = asArray(entry.cites ?? entry.sources)
      .map((id) => String(id).trim().toUpperCase())
      .filter((id) => byId.has(id));
    if (!text || !cited.length) continue;
    points.push({
      text,
      sources: [...new Set(cited.map((id) => byId.get(id)!))],
    });
    if (points.length >= MAX_POINTS) break;
  }
  return {
    summary: asText(root.summary, 500),
    points,
    gaps: asArray(root.gaps)
      .map((gap) => asText(gap, 200))
      .filter(Boolean)
      .slice(0, 5),
  };
}
