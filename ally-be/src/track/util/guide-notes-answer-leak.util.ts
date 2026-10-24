import { QuizContent, QuizQuestion, QuizQuestionType } from '../type/quiz.type';
import {
  ArticleContent,
  TrackItemType,
  VideoContent,
} from '../type/track.type';

/**
 * The firewall for trainer notes (plans/ally-guide/plan.md §6.4, §10.5).
 * `tracks.guideNotes` reaches Ally's prompt, and Ally must never be able to
 * hand a learner a quiz answer — so notes that carry one are refused on save
 * rather than trusted to the model's discretion.
 *
 * An answer here is what the course marks correct: the text of a correct
 * multiple-choice option, or a fill-in-the-blank accepted answer, in a quiz,
 * an article's inline check or a video interjection.
 *
 * Matching is on normalised text (case, accents' composed form and
 * punctuation ignored; Indic vowel signs kept — they are marks, not
 * punctuation). A long answer (three or more words, or 16+ characters) is a
 * leak wherever it appears. A short one — "Reflection", "Yes" — is a
 * leak only in a sentence that also restates its question, because a course
 * on reflective listening will rightly say "reflection" in its notes; what
 * must not appear is the question paired with its answer.
 */

export interface AnswerKeyEntry {
  itemId: string;
  itemTitle: string;
  questionId: string;
  prompt: string;
  answer: string;
}

export interface AnswerLeak {
  itemId: string;
  itemTitle: string;
  questionId: string;
  /** The answer as the course has it, so the editor can point at it. */
  answer: string;
}

interface ItemLike {
  id: string;
  title?: string | null;
  type: TrackItemType | string;
  content?: unknown;
}

const LONG_ANSWER_WORDS = 3;
const LONG_ANSWER_CHARS = 16;
const MIN_PROMPT_OVERLAP = 2;
const PROMPT_OVERLAP_SHARE = 0.4;
const MAX_PROMPT_OVERLAP_NEEDED = 4;

/** Words too common to show a sentence is restating a question. */
const STOPWORDS = new Set([
  'what',
  'which',
  'when',
  'where',
  'with',
  'this',
  'that',
  'their',
  'there',
  'they',
  'would',
  'should',
  'could',
  'does',
  'from',
  'have',
  'your',
  'about',
  'best',
  'most',
  'following',
  'true',
  'false',
]);

export function normaliseForMatch(text: string): string {
  return ` ${(text ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/<[^>]*>/g, ' ')
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
    .trim()} `;
}

const significantWords = (text: string): Set<string> =>
  new Set(
    normaliseForMatch(text)
      .trim()
      .split(' ')
      .filter((word) => word.length >= 4 && !STOPWORDS.has(word)),
  );

function answersOf(question: QuizQuestion): string[] {
  switch (question.type) {
    case QuizQuestionType.MCQ_SINGLE:
    case QuizQuestionType.MCQ_MULTI: {
      const correct = new Set(question.correctOptionIds ?? []);
      return (question.options ?? [])
        .filter((option) => correct.has(option.id))
        .map((option) => option.text);
    }
    case QuizQuestionType.FILL_BLANK:
      return (question.blanks ?? []).flatMap(
        (blank) => blank.acceptedAnswers ?? [],
      );
    default:
      // True/false keys are a bare boolean, and ordering, matching and
      // rubric-graded answers have no single "correct text" to look for.
      return [];
  }
}

function questionsOf(item: ItemLike): QuizQuestion[] {
  const content = (item.content ?? {}) as Record<string, unknown>;
  switch (item.type) {
    case TrackItemType.QUIZ:
      return ((content as unknown as QuizContent).questions ?? []).filter(
        Boolean,
      );
    case TrackItemType.ARTICLE:
      return (content as unknown as ArticleContent).questions ?? [];
    case TrackItemType.VIDEO:
      return ((content as unknown as VideoContent).interjections ?? [])
        .map((interjection) => interjection?.question)
        .filter((question): question is QuizQuestion => Boolean(question));
    default:
      return [];
  }
}

/** Every marked-correct answer text in the course, with where it lives. */
export function collectAnswerKeys(items: ItemLike[]): AnswerKeyEntry[] {
  const keys: AnswerKeyEntry[] = [];
  for (const item of items) {
    for (const question of questionsOf(item)) {
      for (const answer of answersOf(question)) {
        if (normaliseForMatch(answer).trim().length < 2) continue;
        keys.push({
          itemId: item.id,
          itemTitle: item.title ?? '',
          questionId: question.id,
          prompt: question.prompt ?? '',
          answer,
        });
      }
    }
  }
  return keys;
}

/** The answers `notes` gives away, one per question (empty = safe to save). */
export function findAnswerLeaks(
  notes: string | null | undefined,
  keys: AnswerKeyEntry[],
): AnswerLeak[] {
  if (!notes?.trim() || !keys.length) return [];
  const whole = normaliseForMatch(notes);
  const sentences = notes
    .split(/[.!?;\n।]+/)
    .map((sentence) => normaliseForMatch(sentence))
    .filter((sentence) => sentence.trim());

  const leaks = new Map<string, AnswerLeak>();
  for (const key of keys) {
    const needle = normaliseForMatch(key.answer);
    if (!whole.includes(needle)) continue;
    const words = needle.trim().split(' ').length;
    const long =
      words >= LONG_ANSWER_WORDS || needle.trim().length >= LONG_ANSWER_CHARS;
    if (!long && !restatesQuestion(sentences, needle, key.prompt)) continue;
    const id = `${key.itemId}:${key.questionId}`;
    if (!leaks.has(id)) {
      leaks.set(id, {
        itemId: key.itemId,
        itemTitle: key.itemTitle,
        questionId: key.questionId,
        answer: key.answer,
      });
    }
  }
  return [...leaks.values()];
}

/** A sentence holding the short answer AND enough of its question's words. */
function restatesQuestion(
  sentences: string[],
  needle: string,
  prompt: string,
): boolean {
  const promptWords = significantWords(prompt);
  for (const word of significantWords(needle)) promptWords.delete(word);
  if (promptWords.size === 0) return false;
  const needed = Math.min(
    MAX_PROMPT_OVERLAP_NEEDED,
    Math.max(
      Math.min(MIN_PROMPT_OVERLAP, promptWords.size),
      Math.ceil(promptWords.size * PROMPT_OVERLAP_SHARE),
    ),
  );
  return sentences.some((sentence) => {
    if (!sentence.includes(needle)) return false;
    let overlap = 0;
    for (const word of promptWords) {
      if (sentence.includes(` ${word} `)) overlap++;
    }
    return overlap >= needed;
  });
}
