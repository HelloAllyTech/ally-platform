/**
 * What a roleplay expects of the counsellor, as the Debrief agent reads it
 * (prod facts 2026-11-16): the roleplay's own SHOULD_DO / SHOULD_NOT_DO
 * behaviours are the main content (205 of 208 roleplays with competencies
 * have them). Competencies have no definition, only a name, so they are
 * labels: a named one is sent with its own behaviours when it has any (48 of
 * 79 have none). A custom competency's name is a generated code
 * (`{userId}_custom_{N}`, `CompetencyService.createCustomCompetency`) that
 * means nothing to anyone, so it adds only its behaviours, merged into the
 * roleplay's lists, and its code is never sent or shown.
 */

/** A named competency of the roleplay: a label, with its behaviours if any. */
export interface DebriefCompetency {
  name: string;
  helpful: string[];
  unhelpful: string[];
}

/** Everything the roleplay expects, for the Analyst. */
export interface RoleplayExpectations {
  /** The roleplay's SHOULD_DO behaviours, then custom competencies' helpful ones. */
  helpful: string[];
  /** The roleplay's SHOULD_NOT_DO behaviours, then custom competencies' unhelpful ones. */
  unhelpful: string[];
  /** Named competencies only; never a custom code. */
  competencies: DebriefCompetency[];
}

/** A whole custom competency name. */
export const CUSTOM_CODE_NAME_RE = /^\d+_custom_\d+$/;
/** A custom competency code anywhere in a text. */
export const CUSTOM_CODE_RE = /\b\d+_custom_\d+\b/g;

export const isCustomCode = (name: string | null | undefined): boolean =>
  CUSTOM_CODE_NAME_RE.test((name ?? '').trim());

export const hasCustomCode = (text: string | null | undefined): boolean =>
  !!text && new RegExp(CUSTOM_CODE_RE.source).test(text);

/** One row of the competencies query: a competency and one of its behaviours. */
export interface CompetencyBehaviourRow {
  id: string;
  name: string | null;
  is_custom: boolean | null;
  behaviour: string | null;
  type: string | null;
}

/** One SHOULD_DO / SHOULD_NOT_DO behaviour of the roleplay itself. */
export interface ScenarioBehaviourRow {
  category: string | null;
  behaviour: string | null;
}

const clean = (s: string | null | undefined) => (s ?? '').trim();

/**
 * The roleplay's expectations: its own behaviours first, then each custom
 * competency's behaviours not already listed; named competencies keep their
 * own behaviours (none is fine) and are never listed twice.
 */
export function buildExpectations(
  rows: CompetencyBehaviourRow[],
  scenarioRows: ScenarioBehaviourRow[] = [],
): RoleplayExpectations {
  const helpful: string[] = [];
  const unhelpful: string[] = [];
  const seen = new Set<string>();
  const add = (list: string[], b: string) => {
    const k = b.toLowerCase();
    if (!b || seen.has(k)) return;
    seen.add(k);
    list.push(b);
  };
  for (const r of scenarioRows ?? []) {
    const b = clean(r.behaviour);
    if (r.category === 'SHOULD_DO') add(helpful, b);
    else if (r.category === 'SHOULD_NOT_DO') add(unhelpful, b);
  }
  const named = new Map<string, DebriefCompetency>();
  for (const r of rows ?? []) {
    const name = clean(r.name);
    const custom = r.is_custom === true || !name || isCustomCode(name);
    const b = clean(r.behaviour);
    const unhelpfulRow = r.type === 'UNHELPFUL';
    if (custom) {
      if (b) add(unhelpfulRow ? unhelpful : helpful, b);
      continue;
    }
    let c = named.get(r.id);
    if (!c) {
      c = { name, helpful: [], unhelpful: [] };
      named.set(r.id, c);
    }
    if (!b) continue;
    const list = unhelpfulRow ? c.unhelpful : c.helpful;
    if (!list.includes(b)) list.push(b);
  }
  return { helpful, unhelpful, competencies: [...named.values()] };
}

/** Every custom code the cards contain, once each. */
export function customCodesIn(cards: unknown): string[] {
  const found = new Set<string>();
  const walk = (v: unknown) => {
    if (typeof v === 'string') {
      for (const m of v.matchAll(CUSTOM_CODE_RE)) found.add(m[0]);
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(cards);
  return [...found];
}

/** Remove the codes from a sentence, tidying the space and punctuation left. */
export function stripCustomCodes(text: string): string {
  return text
    .replace(CUSTOM_CODE_RE, '')
    .replace(/["“”'‘’]\s*["“”'‘’]/g, '')
    .replace(/\(\s*\)/g, '')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/^[\s,;:]+/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * The cards with no custom code left in them: a skill (or skill word / label)
 * that is a code becomes the competency's first helpful behaviour when
 * `resolved` knows it, else the field (or entry) goes; a code inside any text
 * is removed. Covers debriefs published before the Analyst was given the
 * behaviours. Returns the same object when there was nothing to clean.
 */
export function withoutCustomCodes<
  T extends Record<string, any> | null | undefined,
>(cards: T, resolved: ReadonlyMap<string, string | null> = new Map()): T {
  if (!cards || !customCodesIn(cards).length) return cards;
  const skillOf = (s: unknown): string | null => {
    if (typeof s !== 'string') return null;
    const t = s.trim();
    if (isCustomCode(t)) return resolved.get(t) ?? null;
    return hasCustomCode(t) ? stripCustomCodes(t) || null : t;
  };
  const text = (v: unknown): unknown => {
    if (typeof v === 'string')
      return hasCustomCode(v) ? stripCustomCodes(v) : v;
    if (Array.isArray(v)) return v.map(text);
    if (v && typeof v === 'object') {
      const o: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) {
        if (k === 'skill' || k === 'lead_skill') {
          const s = skillOf(x);
          if (s != null) o[k] = s;
        } else {
          o[k] = text(x);
        }
      }
      return o;
    }
    return v;
  };
  const out = text(cards) as Record<string, any>;
  // A skill word or label for a code nobody can name says nothing.
  for (const key of ['skill_words', 'skill_labels'] as const) {
    if (Array.isArray(out[key])) {
      out[key] = out[key].filter(
        (w: { skill?: unknown }) => typeof w?.skill === 'string' && w.skill,
      );
    }
  }
  return out as T;
}

/**
 * Each custom competency code to its first HELPFUL behaviour (null when it
 * has none, or cannot be read), so a card that names a code can name what it
 * means instead. Never throws: a code that cannot be resolved is dropped.
 */
export async function resolveCustomCodes(
  db: { query: (sql: string, params?: unknown[]) => Promise<any> },
  codes: string[],
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>(codes.map((c) => [c, null]));
  if (!codes.length) return out;
  try {
    const rows: Array<{ code: string; behaviour: string | null }> =
      await db.query(
        `SELECT DISTINCT ON (c.name) c.name AS code, b.name AS behaviour
           FROM competencies c
           JOIN competency_behaviors cb ON cb."competencyId" = c.id
                                       AND cb.type = 'HELPFUL'
           JOIN behaviors b ON b.id = cb."behaviorId"
          WHERE c.name = ANY($1::text[])
          ORDER BY c.name, cb."createdAt", b.name`,
        [codes],
      );
    for (const r of rows ?? []) {
      if (r?.behaviour?.trim()) out.set(r.code, r.behaviour.trim());
    }
  } catch {
    // Unresolved codes are dropped from the cards, never shown.
  }
  return out;
}

/**
 * The cards a reader sees with every custom code replaced or removed
 * (debriefs published before this guard; review 2026-11-16).
 */
export async function readableCards<
  T extends Record<string, any> | null | undefined,
>(
  db: { query: (sql: string, params?: unknown[]) => Promise<any> },
  cards: T,
): Promise<T> {
  const codes = customCodesIn(cards);
  if (!codes.length) return cards;
  return withoutCustomCodes(cards, await resolveCustomCodes(db, codes));
}
