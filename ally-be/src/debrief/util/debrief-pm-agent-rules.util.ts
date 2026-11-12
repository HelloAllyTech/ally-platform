import {
  DEBRIEF_PROMPT_CODES,
  PM_AGENT_EDITABLE_PROMPTS,
  PM_AGENT_SETTINGS,
} from '../constants/debrief-release.constants';
import { OWNER_SETTINGS_SPEC } from '../constants/debrief-owner-settings.constants';
import {
  ASK_ALLY_GATEWAY_TOOLS,
  DEBRIEF_ORCHESTRATOR_TOOLS,
} from '../service/debrief-run-token.service';

/**
 * What the PM agent may and may not change (spec C3, C4, FR-53), as pure
 * functions the gateway calls before anything is written. A refusal is a
 * readable sentence the agent gets back as a tool error; `neverList` marks the
 * C4 refusals, which count against a clean path (METRICS.md, pmIdeaOutcome).
 */

export interface Refusal {
  reason: string;
  /** One of C4's never-list areas, when that is why. */
  neverList?: NeverListArea;
}

export type NeverListArea =
  | 'context_library'
  | 'judge'
  | 'safety'
  | 'budgets'
  | 'data_access'
  | 'approval_list';

const NEVER: Record<NeverListArea, string> = {
  context_library:
    'Context Library chunks are never changed by the PM agent (never-list); ask a person (route D)',
  judge:
    "the judge's rubric and model are the fixed yardstick, never changed by the PM agent (never-list); ask a person (route D)",
  safety:
    "safety rules and the Safety reader's instructions are never changed by the PM agent (never-list); ask a person (route D)",
  budgets:
    'budgets are never changed by the PM agent (never-list); ask the owner (route D)',
  data_access:
    'data access and scopes are never changed by the PM agent (never-list); ask the owner (route D)',
  approval_list:
    'what needs a person’s approval is never changed by the PM agent (never-list); ask the owner (route D)',
};

const never = (area: NeverListArea): Refusal => ({
  reason: NEVER[area],
  neverList: area,
});

/** Prompt codes on the never-list, and why. Anything else not editable is pinned. */
const NEVER_PROMPTS: Record<string, NeverListArea> = {
  [DEBRIEF_PROMPT_CODES.rubric]: 'judge',
  debrief_quality_judge_system: 'judge',
  [DEBRIEF_PROMPT_CODES.safetyReader]: 'safety',
  // Its own instructions say what it may do and what needs a person.
  [DEBRIEF_PROMPT_CODES.pmAgent]: 'approval_list',
};

export function promptEditRefusal(
  code: string | null | undefined,
  find: string | null | undefined,
  replace: string | null | undefined,
  liveText: string | null,
): Refusal | null {
  if (!code) return { reason: 'name the prompt to edit (prompt_code)' };
  if (NEVER_PROMPTS[code]) return never(NEVER_PROMPTS[code]);
  if (!PM_AGENT_EDITABLE_PROMPTS.has(code)) {
    return {
      reason: `${code} is not a prompt the PM agent may edit; editable: ${[
        ...PM_AGENT_EDITABLE_PROMPTS,
      ].join(', ')}`,
    };
  }
  if (!find || replace == null) {
    return { reason: 'a prompt edit needs both find and replace' };
  }
  if (find === replace) return { reason: 'find and replace are the same' };
  if (!liveText) return { reason: `${code} has no live text to edit` };
  const at = liveText.indexOf(find);
  if (at < 0) {
    return {
      reason: `the find passage is not in ${code}'s live text; copy it exactly from editable_prompts`,
    };
  }
  if (liveText.indexOf(find, at + 1) >= 0) {
    return {
      reason: `the find passage appears more than once in ${code}; quote a longer passage`,
    };
  }
  const vars = (s: string) => new Set(s.match(/\{[a-z_][a-z0-9_]*\}/gi) ?? []);
  const before = vars(find);
  const after = vars(replace);
  const changed =
    [...before].some((v) => !after.has(v)) ||
    [...after].some((v) => !before.has(v));
  if (changed) {
    return {
      reason:
        'the edit adds or removes a {variable}; that needs code first (route B)',
    };
  }
  return null;
}

/** Bundle settings the PM agent may never touch, and why. */
const NEVER_SETTINGS: Record<string, NeverListArea> = {
  runCeilingUsd: 'budgets',
  runFloorUsd: 'budgets',
  poolPerSessionUsd: 'budgets',
  monthlyCapUsd: 'budgets',
  // The publish bar is the judge's yardstick.
  passScore: 'judge',
};

export function settingRefusal(
  key: string | null | undefined,
  value: unknown,
): Refusal | null {
  if (!key) return { reason: 'name the setting (setting_key)' };
  if (NEVER_SETTINGS[key]) return never(NEVER_SETTINGS[key]);
  if (key in OWNER_SETTINGS_SPEC) {
    // The ladder's thresholds, the learning budget and the autonomy mode.
    const spec = (OWNER_SETTINGS_SPEC as Record<string, { budget?: boolean }>)[
      key
    ];
    return never(spec.budget ? 'budgets' : 'approval_list');
  }
  if (key === 'deadlineMs' || key === 'riskDeadlineMs') {
    return {
      reason:
        'deadlines are a promise to learners; ask the owner (route D) instead',
    };
  }
  const range = PM_AGENT_SETTINGS[key];
  if (!range) {
    return {
      reason: `${key} is not a setting the PM agent may change; it may change: ${Object.keys(
        PM_AGENT_SETTINGS,
      ).join(', ')}`,
    };
  }
  const v = Number(value);
  if (!Number.isFinite(v) || v < range.min || v > range.max) {
    return { reason: `${key} must be between ${range.min} and ${range.max}` };
  }
  if (!Number.isInteger(v)) return { reason: `${key} takes a whole number` };
  return null;
}

// --- FR-53: system-made registry agents --------------------------------------------

/**
 * The registered tool catalogue (spec A4): the gateway tools registry agents
 * already call. A system-made agent uses only these.
 */
export const REGISTRY_AGENT_TOOLS: ReadonlySet<string> = new Set<string>([
  ...ASK_ALLY_GATEWAY_TOOLS,
  ...DEBRIEF_ORCHESTRATOR_TOOLS,
]);
/** The scopes an agent may read (spec A2; ally-ai `registry/manifest.py` SCOPES). */
export const REGISTRY_AGENT_SCOPES: ReadonlySet<string> = new Set([
  'session',
  'learner_history',
  'org_protocols',
  'aggregates',
  'guidance',
]);
export const FR53 = {
  minEvalCases: 10,
  maxExperimental: 10,
  retireAfterWeeks: 8,
  retireAfterRuns: 200,
} as const;

export interface RegistryAgentManifest {
  id?: string;
  description?: string;
  use_when?: string;
  skip_when?: string;
  prompt?: string;
  tools?: string[];
  scopes?: string[];
  eval_cases?: number;
  model?: string | null;
}

export function registryAgentRefusal(
  m: RegistryAgentManifest | null | undefined,
  experimentalNow: number,
  approvedModels: ReadonlySet<string>,
): Refusal | null {
  if (!m) return { reason: 'a registry agent needs its manifest (agent)' };
  if (!m.id || !/^[a-z][a-z0-9_]{2,40}$/.test(m.id)) {
    return { reason: 'id must be snake_case, 3-41 characters' };
  }
  for (const f of ['description', 'use_when', 'skip_when', 'prompt'] as const) {
    if (!m[f] || !String(m[f]).trim()) return { reason: `${f} is required` };
  }
  const newTools = (m.tools ?? []).filter((t) => !REGISTRY_AGENT_TOOLS.has(t));
  if (newTools.length) {
    return {
      reason: `a system-made agent may use only registered tools (FR-53); ${newTools.join(', ')} would need code (route B)`,
    };
  }
  const badScopes = (m.scopes ?? []).filter(
    (s) => !REGISTRY_AGENT_SCOPES.has(s),
  );
  if (badScopes.length) return never('data_access');
  if (!m.scopes?.length) return { reason: 'name the scopes it reads' };
  if ((m.eval_cases ?? 0) < FR53.minEvalCases) {
    return {
      reason: `a system-made agent needs at least ${FR53.minEvalCases} eval cases (FR-53)`,
    };
  }
  if (experimentalNow >= FR53.maxExperimental) {
    return {
      reason: `${FR53.maxExperimental} experimental agents already exist (FR-53); retire one first`,
    };
  }
  if (m.model && !approvedModels.has(m.model)) {
    return { reason: `${m.model} is not an approved model` };
  }
  return null;
}

// --- Hand-offs ----------------------------------------------------------------------

const NEVER_TERMS: Array<[RegExp, NeverListArea]> = [
  [/context library|guidance (chunk|entr|passage)/, 'context_library'],
  [/rubric|judge('s)? (model|prompt|score)/, 'judge'],
  [/safety (rule|reader|check)|risk[- ]cue (rule|check)/, 'safety'],
  [/budget|monthly cap|run ceiling|spend cap/, 'budgets'],
  [/scope|data access|privacy class|redact/, 'data_access'],
  [/approval|human[- ]in[- ]the[- ]loop|autonomy/, 'approval_list'],
];
const CHANGE_VERBS =
  /\b(change|edit|modify|rewrite|raise|lower|increase|decrease|remove|relax|loosen|weaken|disable|bypass|skip|drop|turn off|widen|lift|replace)\w*\b/;

/**
 * A Builder brief or bug report that asks to change something on the
 * never-list (a change verb within a few words of a never-list term) is
 * refused: those are route D, however the work would be done.
 */
export function handoffNeverListRefusal(...texts: string[]): Refusal | null {
  const text = texts.join(' \n ').toLowerCase();
  for (const sentence of text.split(/[.!?\n;]+/)) {
    if (!CHANGE_VERBS.test(sentence)) continue;
    for (const [term, area] of NEVER_TERMS) {
      if (term.test(sentence)) return never(area);
    }
  }
  return null;
}

/** Route → the idea kind the ladder and the Console know. Route A is set by the draft. */
export const ROUTE_KIND: Record<'A' | 'B' | 'C' | 'D', string> = {
  A: 'route_a',
  B: 'needs_code',
  C: 'defect',
  D: 'needs_person',
};

// --- Quotes never reach Builder or Bug Hunter (spec B4) ----------------------------

export const QUOTE_REMOVED = '[quote removed]';
const QUOTED =
  /"[^"\n]{3,}"|“[^”\n]{3,}”|‘[^’\n]{3,}’|«[^»\n]{3,}»|„[^“\n]{3,}“|`[^`\n]{3,}`/g;
const BLOCK_QUOTE = /^\s*>.*$/gm;
/** Known text shorter than this is not searched for (too likely to match by chance). */
const MIN_KNOWN = 12;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * `text` with quoted passages, block quotes and any of the `known` texts (the
 * cited comments' bodies and quoted spans) replaced, and how many were removed.
 * The same rule as ally-ai's `strip_quotes`; run here too so a summary that
 * slipped past the agent is still caught.
 */
export function stripQuotes(
  text: string,
  known: string[] = [],
): { text: string; removed: number } {
  let removed = 0;
  const count = (re: RegExp, s: string) =>
    s.replace(re, () => {
      removed += 1;
      return QUOTE_REMOVED;
    });
  let out = count(BLOCK_QUOTE, count(QUOTED, text ?? ''));
  for (const k of known) {
    const words = (k ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.join(' ').length < MIN_KNOWN) continue;
    out = count(new RegExp(words.map(escapeRe).join('\\s+'), 'gi'), out);
  }
  return { text: out, removed };
}

// --- Guidance proposals: route D, never a write (spec C4, plan §11.6, FR-56) -------

/** Plan §11.6: a new or changed passage is backed by at least this many learners… */
export const GUIDANCE_MIN_LEARNERS = 10;
/** …and, when it applies platform-wide, this many organisations. */
export const GUIDANCE_MIN_TENANTS = 3;
/** A run of this many of a learner's words in a row is copying, not paraphrase. */
export const GUIDANCE_COPY_WORDS = 6;

/**
 * Text that reads as instructions to a model rather than practice guidance
 * for a counsellor (plan §11.6 "instruction-pattern filter"): a passage the
 * Writer reads must not be able to steer it.
 */
const INSTRUCTION_PATTERNS: RegExp[] = [
  /\bignore\b.{0,30}\b(instruction|rule|prompt|above|previous)/i,
  /\b(disregard|override|bypass)\b.{0,30}\b(instruction|rule|prompt|guideline|safety)/i,
  /\bsystem prompt\b/i,
  /\byou are (now |an? )?(ai|assistant|model|chatbot|language model)\b/i,
  /\b(as an ai|as a language model)\b/i,
  /\b(always|never) (respond|reply|answer|output|say)\b/i,
  /\b(do not|don't) (mention|reveal|tell)\b.{0,30}\b(instruction|prompt|rule)/i,
  /<\/?(system|assistant|user|instructions?)>/i,
  /\[\/?(inst|system)\]/i,
  /<\|[a-z_]+\|>/i,
  /```/,
  /\{[a-z_][a-z0-9_]*\}/i,
];

/** The first instruction-like pattern in a draft, or null. */
export function instructionPatternIn(text: string): string | null {
  for (const p of INSTRUCTION_PATTERNS) {
    const m = (text ?? '').match(p);
    if (m) return m[0];
  }
  return null;
}

const words = (s: string) =>
  (s ?? '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);

/**
 * Whether a draft copies a learner's (or client's) words: any
 * `GUIDANCE_COPY_WORDS` words in a row that also appear in a row in one of
 * the cited sessions' turns (plan §11.6 "doesn't copy learner text").
 */
export function copiesSessionText(
  draft: string,
  turns: string[],
  n = GUIDANCE_COPY_WORDS,
): boolean {
  const grams = new Set<string>();
  for (const t of turns) {
    const w = words(t);
    for (let i = 0; i + n <= w.length; i++) {
      grams.add(w.slice(i, i + n).join(' '));
    }
  }
  if (!grams.size) return false;
  const d = words(draft);
  for (let i = 0; i + n <= d.length; i++) {
    if (grams.has(d.slice(i, i + n).join(' '))) return true;
  }
  return false;
}

/** The evidence rule for a guidance proposal; a refusal sentence or null. */
export function guidanceEvidenceRefusal(
  scope: 'organisation' | 'platform',
  learners: number,
  tenants: number,
): Refusal | null {
  if (learners < GUIDANCE_MIN_LEARNERS) {
    return {
      reason: `a guidance proposal needs evidence from at least ${GUIDANCE_MIN_LEARNERS} learners; the cited runs have ${learners}`,
    };
  }
  if (scope === 'platform' && tenants < GUIDANCE_MIN_TENANTS) {
    return {
      reason: `platform-wide guidance needs evidence from at least ${GUIDANCE_MIN_TENANTS} organisations; the cited runs have ${tenants}`,
    };
  }
  if (scope === 'organisation' && tenants > 1) {
    return {
      reason:
        "guidance for one organisation cites that organisation's runs only; use scope platform",
    };
  }
  return null;
}
