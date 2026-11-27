import {
  LEARNER_RESULTS_MIN_LEARNERS,
  LearnerResults,
  LearnerResultsItem,
} from '../service/course-copilot-learner-results.service';

/**
 * Course Pilot's Analyst, code half: the signals worth a trainer's attention in a course's
 * learner results. The results come from CourseCopilotLearnerResultsService, the same numbers
 * get_learner_results gives: the session's organisation only, test organisations and review
 * enrolments out, and an item reached by fewer than LEARNER_RESULTS_MIN_LEARNERS learners withheld
 * (reached 0, no notes). The Analyst model only explains these signals; it never sees a learner.
 */
/** Below this share of learners who reached an item finishing it, the item stalls them. */
export const COURSE_PILOT_STALL_PCT = 60;
/** Below this share right on a first try, a quiz question is too hard, unclear or mis-keyed. */
export const COURSE_PILOT_HARD_QUESTION_PCT = 40;
/** Above this many attempts on average, an item's pass rule is hard to meet. */
export const COURSE_PILOT_HARD_ATTEMPTS = 2;
/** A course most learners do not finish. */
export const COURSE_PILOT_LOW_COMPLETION_PCT = 50;

export interface AnalysisSignal {
  kind:
    | 'low_completion'
    | 'drop_off'
    | 'stall'
    | 'hard_question'
    | 'hard_to_pass';
  itemId?: string;
  /** One sentence, numbers included, for the trainer and the Analyst. */
  text: string;
}

const ORDER: AnalysisSignal['kind'][] = [
  'low_completion',
  'drop_off',
  'stall',
  'hard_question',
  'hard_to_pass',
];

/** The quiz notes name the most-missed questions as `"text" (N% right)`. */
function weakQuestions(
  item: LearnerResultsItem,
): { text: string; right: number }[] {
  const out: { text: string; right: number }[] = [];
  for (const note of item.notes) {
    if (!note.startsWith('most missed on first try:')) continue;
    for (const match of note.matchAll(/"([^"]+)" \((\d+)% right\)/g)) {
      out.push({ text: match[1], right: Number(match[2]) });
    }
  }
  return out;
}

/** Pure: learner results → signals, most important first (at most 12). */
export function analysisSignals(results: LearnerResults): AnalysisSignal[] {
  if (results.enrolled < LEARNER_RESULTS_MIN_LEARNERS) return [];
  const signals: AnalysisSignal[] = [];
  const finishedPct = Math.round((results.completed / results.enrolled) * 100);
  if (finishedPct < COURSE_PILOT_LOW_COMPLETION_PCT) {
    signals.push({
      kind: 'low_completion',
      text: `${results.completed} of ${results.enrolled} enrolled learners (${finishedPct}%) finished the course.`,
    });
  }

  // Withheld items (fewer learners than the floor) read as reached 0: never compared.
  const measured = (item?: LearnerResultsItem) => !!item && item.reached > 0;
  let worst: {
    from: LearnerResultsItem;
    to: LearnerResultsItem;
    lost: number;
  } | null = null;
  results.items.forEach((item, index) => {
    const next = results.items[index + 1];
    if (!measured(item) || !measured(next)) return;
    const lost = item.completed - next.reached;
    if (lost > 0 && (!worst || lost > worst.lost))
      worst = { from: item, to: next, lost };
  });
  const drop = worst as {
    from: LearnerResultsItem;
    to: LearnerResultsItem;
    lost: number;
  } | null;
  if (drop && drop.lost / results.enrolled >= 0.2) {
    signals.push({
      kind: 'drop_off',
      itemId: drop.to.itemId,
      text: `${drop.lost} learners finished "${drop.from.title}" but never started "${drop.to.title}" (${drop.to.type}).`,
    });
  }

  for (const item of results.items) {
    if (!measured(item)) continue;
    if (
      item.completionPct !== null &&
      item.completionPct < COURSE_PILOT_STALL_PCT
    ) {
      signals.push({
        kind: 'stall',
        itemId: item.itemId,
        text: `"${item.title}" (${item.type}): ${item.completed} of ${item.reached} learners who reached it finished it (${item.completionPct}%).`,
      });
    }
    for (const question of weakQuestions(item)) {
      if (question.right < COURSE_PILOT_HARD_QUESTION_PCT) {
        signals.push({
          kind: 'hard_question',
          itemId: item.itemId,
          text: `In "${item.title}", only ${question.right}% got "${question.text}" right first time.`,
        });
      }
    }
    if (
      item.avgAttempts !== null &&
      item.avgAttempts > COURSE_PILOT_HARD_ATTEMPTS
    ) {
      signals.push({
        kind: 'hard_to_pass',
        itemId: item.itemId,
        text: `"${item.title}" (${item.type}) took ${item.avgAttempts} attempts on average${item.avgScore !== null ? ` (average score ${item.avgScore})` : ''}.`,
      });
    }
  }
  return signals
    .sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind))
    .slice(0, 12);
}
