import { DebriefCards } from './debrief-cards.util';

/**
 * v9 FR-20 / FR-42: what a published live debrief writes where today's
 * debrief wrote it, so everything downstream (skill analytics, the
 * supervisor memory, the Ally guide's after-action review, the post-session
 * judges) reads the debrief the learner actually reads. Pure functions; the
 * publish service does the writing.
 */

/**
 * The three skill-coverage categories today's debrief scores
 * (`shared/skill_coverage.txt`). Kept by name so the Track and skill-growth
 * charts continue across the cutover rather than starting new series.
 */
export const COVERAGE_CATEGORIES = [
  'Listening Engagement',
  'Emotional Attunement',
  'Supportive Engagement',
] as const;
export type CoverageCategory = (typeof COVERAGE_CATEGORIES)[number];

/** Stamped on everything a published debrief writes (FR-20 "Stamps", FR-42 "version-stamped"). */
export interface DebriefGeneratorStamp {
  agent: 'debrief';
  runId: string;
  releaseId: string | null;
  version: number | null;
  publishedAt: string;
}

/** Observation weights v9 §3.3 uses: observed 1, partial 0.5, missed 0. */
const OBSERVATION_WEIGHT: Record<string, number> = {
  observed: 1,
  partial: 0.5,
  missed: 0,
};

/**
 * Skill coverage computed in code from the evidence map (v9 FR-42): per
 * category, the share of behaviours the learner had a chance at that they
 * showed, partial counting half. Only behaviours the Analyst tagged with a
 * category count; a category with no chances is left out rather than
 * reported as 0%, which would read as "never shown".
 */
export function skillCoverageFromEvidence(
  evidence: Record<string, any> | null | undefined,
): Array<{ category: CoverageCategory; percentage: number }> {
  const behaviours: Array<Record<string, any>> = Array.isArray(
    evidence?.behaviours,
  )
    ? evidence!.behaviours
    : [];
  const out: Array<{ category: CoverageCategory; percentage: number }> = [];
  for (const category of COVERAGE_CATEGORIES) {
    const chances = behaviours.filter(
      (b) =>
        b?.coverage_category === category &&
        b?.opportunity !== false &&
        b?.observation in OBSERVATION_WEIGHT,
    );
    if (chances.length === 0) continue;
    const score = chances.reduce(
      (sum, b) => sum + OBSERVATION_WEIGHT[b.observation],
      0,
    );
    out.push({
      category,
      percentage: Math.round((score / chances.length) * 100),
    });
  }
  return out;
}

const quoted = (q?: string | null) => (q?.trim() ? `“${q.trim()}”` : '');

/**
 * The cards as one note in the learner's language, for the readers that take
 * a note (`summary.feedback.supervisorNote`): the Ally guide's practice
 * history, the session context, the post-session judges. No turn numbers —
 * some of those readers are learner-facing, and the quote is how a moment is
 * found. Headings stay English: they are structure for the judges, and the
 * learner reads the cards, not this.
 */
export function renderSupervisorNote(cards: DebriefCards): string {
  const parts: string[] = [];
  if (cards.opening?.trim()) parts.push(cards.opening.trim());
  const m = cards.important_moment;
  if (m) {
    parts.push(
      [
        '**An important moment**',
        [m.lead, quoted(m.quote), m.body].filter(Boolean).join(' '),
        ...(m.others ?? []).map((o) =>
          `- ${[quoted(o.quote), o.note].filter(Boolean).join(' ')}`.trim(),
        ),
      ].join('\n'),
    );
  }
  if (cards.what_worked?.length) {
    parts.push(
      [
        '**What worked**',
        ...cards.what_worked.map((c) =>
          `- ${[c.lead, quoted(c.quote), c.body].filter(Boolean).join(' ')}`.trim(),
        ),
      ].join('\n'),
    );
  }
  if (cards.work_on_this?.length) {
    parts.push(
      [
        '**Work on this**',
        ...cards.work_on_this.map((c) =>
          `- ${[
            c.lead,
            quoted(c.quote),
            c.why,
            c.try_saying ? `Try saying: ${quoted(c.try_saying)}` : '',
          ]
            .filter(Boolean)
            .join(' ')}`.trim(),
        ),
      ].join('\n'),
    );
  }
  if (cards.practise_next) {
    parts.push(
      `**Practise this next:** ${cards.practise_next.skill}. ${cards.practise_next.reason}`.trim(),
    );
  }
  if (cards.progress_note?.trim()) parts.push(cards.progress_note.trim());
  if (cards.reflective_question?.trim()) {
    parts.push(
      `**One question to think about:** ${cards.reflective_question.trim()}`,
    );
  }
  return parts.join('\n\n');
}

/**
 * The note's claims as today's debrief listed them, for the readers that take
 * lists (the feedback-groundedness judge checks each one against the
 * transcript): what worked as positives, what to work on as improvements.
 */
export function claimsFromCards(cards: DebriefCards): {
  positives: string[];
  improvements: string[];
} {
  return {
    positives: (cards.what_worked ?? [])
      .map((c) => [c.lead, c.body].filter(Boolean).join(' ').trim())
      .filter(Boolean),
    improvements: (cards.work_on_this ?? [])
      .map((c) => [c.lead, c.why].filter(Boolean).join(' ').trim())
      .filter(Boolean),
  };
}

/**
 * The supervisor memory update (v9 FR-20: anchored facts only): what the
 * learner was asked to work on, how this session went in the debrief's own
 * words, and the one thing to practise next. Built only from the published
 * cards, so nothing the learner was not told is carried forward.
 */
export function memoryUpdateFromCards(cards: DebriefCards): {
  focus_areas: string[];
  trajectory: string;
  next_time: string;
} | null {
  const focus = [
    ...new Set(
      (cards.work_on_this ?? [])
        .map((c) => c.skill?.trim())
        .filter((s): s is string => !!s),
    ),
  ];
  const trajectory = (cards.progress_note ?? cards.opening ?? '').trim();
  const next = cards.practise_next
    ? `${cards.practise_next.skill}: ${cards.practise_next.reason}`.trim()
    : (cards.work_on_this?.[0]?.try_saying ?? '').trim();
  if (!focus.length && !trajectory && !next) return null;
  return {
    focus_areas: focus,
    trajectory: trajectory.slice(0, 600),
    next_time: next.slice(0, 400),
  };
}
