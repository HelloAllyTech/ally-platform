import { Injectable } from '@nestjs/common';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import {
  GUIDE_NOTES_MAX_CHARS,
  GuideNotesTension,
} from 'src/track/type/track-guide-notes.type';
import {
  AnswerKeyEntry,
  findAnswerLeaks,
} from 'src/track/util/guide-notes-answer-leak.util';
import {
  COURSE_COPILOT_AI_TASKS,
  COURSE_COPILOT_JOB_MAX_ATTEMPTS,
  COURSE_COPILOT_PROMPTS,
} from '../../constants/course-copilot.constants';
import { SpecialistLlmService } from './specialist-llm.service';
import { SpecialistValidationError } from './specialist.types';
import {
  asRecord,
  asText,
  htmlToText,
  SPECIALIST_MAX_TOKENS,
  truncateAtWord,
  typeLabel,
} from './specialist.util';

/** What the writer is asked for; the hard cap is GUIDE_NOTES_MAX_CHARS. */
const NOTES_TARGET_CHARS = 1200;
const EXCERPT_MAX_CHARS = 240;
const TENSIONS: readonly GuideNotesTension[] = ['low', 'medium', 'high'];

export interface AllyNotesItemInput {
  id: string;
  type: string;
  title: string;
  description?: string | null;
  /** Plain-text excerpt (article opening, roleplay scenario); never a quiz. */
  excerpt?: string | null;
  defaultTension: GuideNotesTension;
}

export interface AllyNotesInput {
  trackId: string;
  title: string;
  description: string;
  sections: { title: string; items: AllyNotesItemInput[] }[];
  triggerWarnings: { itemTitle: string; names: string[] }[];
  currentNotes: string | null;
  /** The course's correct answers: the draft is checked against them. */
  answerKeys: AnswerKeyEntry[];
  usageMetadata: Record<string, unknown>;
}

export interface AllyNotesDraft {
  notes: string;
  /** Overrides only: items whose tension differs from the default. */
  tension: Record<string, GuideNotesTension>;
}

/**
 * Drafts a course's notes for the Ally guide (plans/ally-guide/plan.md
 * §10.1 "Course Copilot ally-notes-draft") and per-item tension overrides.
 *
 * One JSON call per click, with one repair pass when the output is unusable
 * or quotes a correct quiz answer. The writer is never shown an answer key;
 * the check exists because article excerpts can contain one. It saves
 * nothing: the builder shows the draft and the trainer saves it through the
 * guide-notes PUT, which runs the same check.
 */
@Injectable()
export class AllyNotesSpecialist {
  constructor(private readonly llm: SpecialistLlmService) {}

  async generate(input: AllyNotesInput): Promise<AllyNotesDraft> {
    const items = input.sections.flatMap((section) => section.items);
    const variables = {
      course_title: input.title || '(untitled)',
      course_description: input.description || '(none yet)',
      course_outline: allyNotesOutlineForPrompt(input.sections),
      trigger_warnings: input.triggerWarnings.length
        ? input.triggerWarnings
            .map((w) => `- ${w.itemTitle}: ${w.names.join(', ')}`)
            .join('\n')
        : '(none)',
      current_notes: input.currentNotes?.trim() || '(none yet)',
    };

    let repairErrors: string[] | undefined;
    for (let attempt = 1; ; attempt++) {
      try {
        const { data } = await this.llm.runJson({
          specialist: 'ally_notes',
          promptCode: COURSE_COPILOT_PROMPTS.ALLY_NOTES_WRITER,
          taskId: COURSE_COPILOT_AI_TASKS.ALLY_NOTES,
          task: LlmTask.COURSE_COPILOT_ALLY_NOTES,
          maxTokens: SPECIALIST_MAX_TOKENS.ALLY_NOTES,
          usageMetadata: input.usageMetadata,
          variables,
          repairErrors,
        });
        return normaliseAllyNotesDraft(data, items, input.answerKeys);
      } catch (error) {
        if (
          !(error instanceof SpecialistValidationError) ||
          attempt >= COURSE_COPILOT_JOB_MAX_ATTEMPTS
        ) {
          throw error;
        }
        repairErrors = error.errors;
      }
    }
  }
}

/** Sections in order; each item with its id, type, default tension, excerpt. */
export function allyNotesOutlineForPrompt(
  sections: AllyNotesInput['sections'],
): string {
  if (!sections.length) return '(the course has no sections yet)';
  const lines: string[] = [];
  sections.forEach((section, index) => {
    lines.push(`Section ${index + 1}: ${section.title || '(untitled)'}`);
    for (const item of section.items) {
      const description = truncateAtWord(
        htmlToText(item.description ?? ''),
        140,
      );
      lines.push(
        `  - (id: ${item.id}) [${typeLabel(item.type)}] ${item.title || '(untitled)'}` +
          ` — default tension ${item.defaultTension}` +
          (description ? `. ${description}` : ''),
      );
      const excerpt = truncateAtWord(
        htmlToText(item.excerpt ?? ''),
        EXCERPT_MAX_CHARS,
      );
      if (excerpt) lines.push(`      Excerpt: ${excerpt}`);
    }
  });
  return lines.join('\n');
}

/**
 * The model's answer as a draft the editor can show: trimmed notes within the
 * cap, tension only for known items, only where it differs from the default.
 *
 * @throws SpecialistValidationError when there are no notes, or they quote a
 *   correct answer (the repair pass is told which phrase, never asked to use it).
 */
export function normaliseAllyNotesDraft(
  data: Record<string, unknown>,
  items: AllyNotesItemInput[],
  answerKeys: AnswerKeyEntry[],
): AllyNotesDraft {
  const raw = asText(data.notes);
  if (!raw) {
    throw new SpecialistValidationError(['"notes" is missing or empty']);
  }
  const notes = truncateAtWord(
    raw.replace(/\r\n?/g, '\n').trim(),
    Math.min(GUIDE_NOTES_MAX_CHARS, NOTES_TARGET_CHARS + 200),
  );
  const leaks = findAnswerLeaks(notes, answerKeys);
  if (leaks.length) {
    throw new SpecialistValidationError(
      leaks.map(
        (leak) =>
          `The notes repeat the answer to a question in "${leak.itemTitle}" ` +
          `("${leak.answer}"). Remove it and do not refer to any answer.`,
      ),
    );
  }

  const defaults = new Map(items.map((item) => [item.id, item.defaultTension]));
  const tension: Record<string, GuideNotesTension> = {};
  for (const [itemId, value] of Object.entries(asRecord(data.tension))) {
    const level = String(value).toLowerCase() as GuideNotesTension;
    if (!defaults.has(itemId) || !TENSIONS.includes(level)) continue;
    if (defaults.get(itemId) !== level) tension[itemId] = level;
  }
  return { notes, tension };
}
