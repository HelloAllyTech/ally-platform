import {
  DebriefArea,
  DebriefSkill,
  DebriefSkillFramework,
  SKILL_FRAMEWORK_KIND,
} from '../constants/debrief-framework.constants';

/**
 * Skill frameworks as data (spec DEBRIEF_ACROSS_ROLEPLAYS §4): reading one from its Context Library
 * entry, writing one back, and naming a skill the Analyst described loosely. Pure.
 */

/** A skill line in the entry: `key | Skill name` (any further column on an old entry is ignored). */
export function parseSkillLine(line: string): DebriefSkill | null {
  const [key, name] = String(line ?? '')
    .split('|')
    .map((p) => p.trim());
  if (!key || !name) return null;
  return {
    key: key.toLowerCase().replace(/[^a-z0-9_-]+/g, '-'),
    name,
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
    ids: [chunk.code],
    name: chunk.statement.trim(),
    foundational: attrs.foundational === true,
    skills,
    areas: lines(attrs.areas)
      .map(parseAreaLine)
      .filter((a): a is DebriefArea => !!a),
  };
}

/**
 * One framework for a run from every entry the organisation can read: skills by key, areas by
 * name, names joined, foundational when any entry says so. No entries is the empty framework.
 */
export function mergeFrameworks(
  fs: ReadonlyArray<DebriefSkillFramework>,
): DebriefSkillFramework {
  const skills = new Map<string, DebriefSkill>();
  const areas = new Map<string, DebriefArea>();
  for (const f of fs) {
    for (const s of f.skills) if (!skills.has(s.key)) skills.set(s.key, s);
    for (const a of f.areas) if (!areas.has(a.name)) areas.set(a.name, a);
  }
  const ids = fs.flatMap((f) => f.ids);
  return {
    id: ids.length === 1 ? ids[0] : null,
    ids,
    name: fs
      .map((f) => f.name)
      .filter(Boolean)
      .join(' + '),
    foundational: fs.some((f) => f.foundational),
    skills: [...skills.values()],
    areas: [...areas.values()],
  };
}

const norm = (text: unknown) =>
  String(text ?? '')
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** A named competency's progress key: the same competency in two roleplays is one line. */
export function competencyKey(name: string): string {
  return `competency:${norm(name)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')}`;
}

/**
 * The progress key for a skill name the Analyst wrote: the framework's own skill (exact key or
 * exact name), then a named competency of the roleplay (exact name), else `other` (sent, never
 * trended). No keyword matching: the Analyst is told the exact keys.
 */
export function skillKeyOf(
  name: unknown,
  framework: DebriefSkillFramework,
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
  return 'other';
}

/** Key → name for every trendable skill: the framework's, then the named competencies'. */
export function skillNamesOf(
  framework: DebriefSkillFramework,
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
