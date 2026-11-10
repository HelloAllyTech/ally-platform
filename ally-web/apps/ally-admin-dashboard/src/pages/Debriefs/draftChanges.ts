import { DebriefCardsData } from "@types";

/** One section of a draft whose text changed between two rounds. */
export interface DraftChange {
  section: string;
  before: string | null;
  after: string | null;
}

/** Each section of a draft as one comparable string, keyed by the name the critique uses. */
export function draftSections(cards: Partial<DebriefCardsData> | null | undefined) {
  const out = new Map<string, string>();
  if (!cards) return out;
  const put = (key: string, parts: Array<string | null | undefined>) => {
    const text = parts.filter(p => typeof p === "string" && p.trim()).join(" · ");
    if (text) out.set(key, text);
  };
  put("opening", [cards.opening]);
  if (cards.important_moment) {
    put("important_moment", [
      cards.important_moment.lead,
      cards.important_moment.body,
      ...(cards.important_moment.others ?? []).map(o => `“${o.quote}” ${o.note}`),
    ]);
  }
  (cards.what_worked ?? []).forEach((c, i) =>
    put(`what_worked[${i}]`, [c.skill, c.lead, `“${c.quote}”`, c.body]),
  );
  (cards.work_on_this ?? []).forEach((c, i) =>
    put(`work_on_this[${i}]`, [c.skill, c.lead, `“${c.quote}”`, c.why, c.try_saying]),
  );
  if (cards.practise_next)
    put("practise_next", [cards.practise_next.skill, cards.practise_next.reason]);
  put("reflective_question", [cards.reflective_question]);
  put("progress_note", [cards.progress_note]);
  return out;
}

/**
 * The sections that differ between two drafts, in the order the learner reads
 * them: changed, added (before is null) or removed (after is null).
 */
export function draftChanges(
  before: Partial<DebriefCardsData> | null | undefined,
  after: Partial<DebriefCardsData> | null | undefined,
): DraftChange[] {
  const a = draftSections(before);
  const b = draftSections(after);
  const keys = [...new Set([...a.keys(), ...b.keys()])];
  return keys
    .filter(k => a.get(k) !== b.get(k))
    .map(k => ({ section: k, before: a.get(k) ?? null, after: b.get(k) ?? null }));
}
