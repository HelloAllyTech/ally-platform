/**
 * Renders a stored debrief into the text the learner actually reads, for the
 * debrief-quality judge.
 *
 * The judge scores what the learner saw. Today's debriefs come in two shapes:
 * the supervisor note (markdown, with `[[msg:<message id>]]` anchors the apps
 * turn into "See this moment" links), and older ones that only have the
 * positives / areas-of-growth lists. The note wins when present, because it is
 * what the apps render.
 */

export type DebriefSource = 'supervisor_note' | 'lists';

export interface RenderedDebrief {
  text: string;
  source: DebriefSource;
}

type Feedback = Record<string, unknown> | null | undefined;

const asStrings = (v: unknown): string[] =>
  Array.isArray(v)
    ? v
        .map((x) => (typeof x === 'string' ? x.trim() : ''))
        .filter((x) => x.length > 0)
    : [];

/**
 * Replace every anchor with the turn it points at, so the judge can check the
 * moment against the numbered transcript. An anchor to a message the
 * transcript does not contain is dropped rather than invented: a link the
 * learner would find broken is not evidence either way.
 */
export function resolveMomentAnchors(
  note: string,
  turnByMessageId: Map<number, number>,
): string {
  return note.replace(/\[\[msg:(\d+)\]\]/g, (_, id: string) => {
    const turn = turnByMessageId.get(Number(id));
    return turn != null ? `(turn ${turn})` : '';
  });
}

export function renderDebrief(
  feedback: Feedback,
  turnByMessageId: Map<number, number>,
): RenderedDebrief | null {
  if (!feedback) return null;

  // Most rows are camelCase, but some were stored with the AI service's
  // snake_case keys; both are the same debrief.
  const note = feedback.supervisorNote ?? feedback.supervisor_note;
  if (typeof note === 'string' && note.trim().length > 0) {
    return {
      text: resolveMomentAnchors(note.trim(), turnByMessageId),
      source: 'supervisor_note',
    };
  }

  const positives = asStrings(feedback.positives);
  const growth: string[] = [];
  const areas = feedback.areasOfGrowth ?? feedback.areas_of_growth;
  if (Array.isArray(areas)) {
    for (const item of areas as Array<Record<string, unknown>>) {
      const improvement =
        typeof item?.improvement === 'string' ? item.improvement.trim() : '';
      const recommendation =
        typeof item?.recommendation === 'string'
          ? item.recommendation.trim()
          : '';
      const line = [improvement, recommendation].filter(Boolean).join(' ');
      if (line) growth.push(line);
    }
  }
  if (growth.length === 0) growth.push(...asStrings(feedback.improvements));

  if (positives.length === 0 && growth.length === 0) return null;

  const parts: string[] = [];
  if (positives.length) {
    parts.push('What worked:', ...positives.map((p) => `- ${p}`));
  }
  if (growth.length) {
    if (parts.length) parts.push('');
    parts.push('Areas to grow:', ...growth.map((g) => `- ${g}`));
  }
  return { text: parts.join('\n'), source: 'lists' };
}
