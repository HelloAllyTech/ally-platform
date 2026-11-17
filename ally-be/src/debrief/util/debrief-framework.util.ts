import {
  DebriefArea,
  DebriefSkill,
  DebriefSkillFramework,
  FOUNDATIONAL_FRAMEWORK,
  SKILL_FRAMEWORK_KIND,
} from '../constants/debrief-framework.constants';

/**
 * Skill frameworks as data (spec DEBRIEF_ACROSS_ROLEPLAYS §4): reading one from its Context Library
 * entry, writing one back, and naming a skill the Analyst described loosely. Pure.
 */

/** A skill line in the entry: `key | Skill name | word, word, word` (words optional). */
export function parseSkillLine(line: string): DebriefSkill | null {
  const [key, name, words] = String(line ?? '')
    .split('|')
    .map((p) => p.trim());
  if (!key || !name) return null;
  return {
    key: key.toLowerCase().replace(/[^a-z0-9_-]+/g, '-'),
    name,
    words: (words ?? '')
      .split(',')
      .map((w) => w.trim().toLowerCase())
      .filter(Boolean),
  };
}

/** An area line in the entry: `Area name | what it covers`. */
export function parseAreaLine(line: string): DebriefArea | null {
  const [name, description] = String(line ?? '')
    .split('|')
    .map((p) => p.trim());
  return name ? { name, description: description ?? '' } : null;
}

const lines = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => String(x ?? '')) : [];

/** A framework from its Context Library entry (a chunk of kind `skill_framework`). */
export function frameworkFromChunk(chunk: {
  code: string;
  statement: string;
  attributes?: Record<string, unknown> | null;
}): DebriefSkillFramework {
  const attrs = chunk.attributes ?? {};
  const seen = new Set<string>();
  const skills = lines(attrs.skills)
    .map(parseSkillLine)
    .filter((s): s is DebriefSkill => {
      if (!s || seen.has(s.key)) return false;
      seen.add(s.key);
      return true;
    });
  return {
    id: chunk.code,
    name: chunk.statement.trim(),
    foundational: attrs.foundational === true,
    skills,
    areas: lines(attrs.areas)
      .map(parseAreaLine)
      .filter((a): a is DebriefArea => !!a),
  };
}

/** The entry's attributes for a framework (what seeding and the editor store). */
export function frameworkAttributes(
  f: DebriefSkillFramework,
): Record<string, unknown> {
  return {
    skills: f.skills.map((s) =>
      [s.key, s.name, s.words.join(', ')].join(' | '),
    ),
    areas: f.areas.map((a) => `${a.name} | ${a.description}`),
    foundational: f.foundational,
  };
}

const norm = (text: unknown) =>
  String(text ?? '')
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const escapeRe = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A named competency's progress key: the same competency in two roleplays is one line. */
export function competencyKey(name: string): string {
  return `competency:${norm(name)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')}`;
}

/**
 * The progress key for a skill name the Analyst wrote: the framework's own skill (by key or exact
 * name), then a named competency of the roleplay (exact name), then a framework skill one of whose
 * words starts a word in the name (narrow skills first), else `other` (sent, never trended).
 */
export function skillKeyOf(
  name: unknown,
  framework: DebriefSkillFramework = FOUNDATIONAL_FRAMEWORK,
  competencies: ReadonlyArray<string> = [],
): string {
  const n = norm(name);
  if (!n) return 'other';
  for (const s of framework.skills) {
    if (n === s.key || n === norm(s.name)) return s.key;
  }
  for (const c of competencies) {
    if (n === norm(c)) return competencyKey(c);
  }
  for (const s of framework.skills) {
    for (const w of s.words) {
      if (new RegExp(`\\b${escapeRe(norm(w))}`).test(n)) return s.key;
    }
  }
  return 'other';
}

/** Key → name for every trendable skill: the framework's, then the named competencies'. */
export function skillNamesOf(
  framework: DebriefSkillFramework = FOUNDATIONAL_FRAMEWORK,
  competencies: ReadonlyArray<string> = [],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of framework.skills) out[s.key] = s.name;
  for (const c of competencies) out[competencyKey(c)] = c;
  return out;
}

/** Whether a Context Library entry is a skill framework. */
export const isFrameworkChunk = (chunk: {
  facets?: Record<string, unknown> | null;
}): boolean => chunk.facets?.kind === SKILL_FRAMEWORK_KIND;
