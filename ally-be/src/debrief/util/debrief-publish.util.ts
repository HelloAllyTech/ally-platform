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

/** The message a transcript turn came from, for `[[msg:<id>]]` anchors. */
export type MessageForTurn = (turn: number) => number | undefined;

/**
 * The cards as today's debrief's note (`summary.feedback.supervisorNote`), so
 * every reader of that note keeps working: the apps' note view (an older
 * phone build, and the fallback when the cards cannot load) splits it on the
 * machine keys `## [what_worked]`, `## [what_it_cost]`, `## [try_next]`,
 * `## [closing]` and turns `[[msg:<id>]]` into "See this moment"; the judges
 * and the Ally guide read it as text. The opening goes before the first key,
 * as the note's unlabelled opening. Body text is the cards' own, in the
 * learner's language; no turn numbers.
 */
export function renderSupervisorNote(
  cards: DebriefCards,
  messageFor: MessageForTurn = () => undefined,
): string {
  const anchor = (turn?: number | null) => {
    const id = typeof turn === 'number' ? messageFor(turn) : undefined;
    return id != null ? ` [[msg:${id}]]` : '';
  };
  const line = (parts: Array<string | null | undefined>) =>
    parts
      .filter((p) => !!p && String(p).trim())
      .join(' ')
      .trim();
  const m = cards.important_moment;
  const momentText = m
    ? [
        line([m.lead, quoted(m.quote) + anchor(m.turn_index), m.body]),
        ...(m.others ?? []).map(
          (o) => `- ${line([quoted(o.quote) + anchor(o.turn_index), o.note])}`,
        ),
      ].join('\n')
    : null;

  const worked = [
    ...(m?.handled_well && momentText ? [momentText] : []),
    ...(cards.what_worked ?? []).map(
      (c) =>
        `- ${line([c.lead, quoted(c.quote) + anchor(c.turn_index), c.body])}`,
    ),
  ];
  const cost = [
    ...(m && !m.handled_well && momentText ? [momentText] : []),
    ...(cards.work_on_this ?? []).map(
      (c) =>
        `- ${line([c.lead, quoted(c.quote) + anchor(c.turn_index), c.why])}`,
    ),
  ];
  const tryNext = [
    ...(cards.work_on_this ?? [])
      .filter((c) => c.try_saying?.trim())
      .map((c) => `- ${quoted(c.try_saying)}`),
    ...(cards.practise_next
      ? [line([cards.practise_next.skill + '.', cards.practise_next.reason])]
      : []),
  ];

  const parts: string[] = [];
  const opening = line([cards.opening, cards.progress_note]);
  if (opening) parts.push(opening);
  if (worked.length) parts.push(['## [what_worked]', ...worked].join('\n'));
  if (cost.length) parts.push(['## [what_it_cost]', ...cost].join('\n'));
  if (tryNext.length) parts.push(['## [try_next]', ...tryNext].join('\n'));
  if (cards.reflective_question?.trim()) {
    parts.push(['## [closing]', cards.reflective_question.trim()].join('\n'));
  }
  return parts.join('\n\n');
}

/**
 * The note's growth areas as today's debrief wrote them
 * (`summary.feedback.areasOfGrowth`), which the feedback-to-skill mapper
 * reads by position: one per point to work on.
 */
export function areasOfGrowthFromCards(
  cards: DebriefCards,
): Array<{ improvement: string; recommendation: string }> {
  return (cards.work_on_this ?? [])
    .map((c) => ({
      improvement: [c.lead, c.why].filter(Boolean).join(' ').trim(),
      recommendation: (c.try_saying ?? '').trim(),
    }))
    .filter((a) => a.improvement);
}

/**
 * The session's emotional movement as today's debrief stored it
 * (`summary.feedback.emotionalMovement`, camelCased): one entry per client
 * message, -5 to +5, with the message's start time. Levels on turns with no
 * message are dropped.
 */
export function emotionalMovementFromEvidence(
  evidence: Record<string, any> | null | undefined,
  messageFor: MessageForTurn,
  startFor: (messageId: number) => number | undefined,
): Array<{ messageId: string; level: number; startTime?: number }> {
  const items: Array<{ turn_index?: number; level?: number }> = Array.isArray(
    evidence?.emotional_movement,
  )
    ? evidence!.emotional_movement
    : [];
  const out: Array<{ messageId: string; level: number; startTime?: number }> =
    [];
  for (const e of items) {
    if (typeof e?.turn_index !== 'number' || typeof e?.level !== 'number')
      continue;
    const id = messageFor(e.turn_index);
    if (id == null) continue;
    const level = Math.max(-5, Math.min(5, Math.round(e.level)));
    const start = startFor(id);
    out.push({
      messageId: String(id),
      level,
      ...(start != null ? { startTime: start } : {}),
    });
  }
  return out;
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
