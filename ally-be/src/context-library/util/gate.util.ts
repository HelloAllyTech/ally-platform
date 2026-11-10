import { CL_VERBATIM_RUN_WORDS } from '../constants/context-library.constants';
import { CollectionProfile } from '../profiles/profile.types';

/**
 * The cheap, deterministic half of the quality gate: everything that can be decided without
 * a model. Run first so model calls are only spent on candidates that could pass.
 *
 * Each check returns reasons rather than a boolean. The yield report counts rejections by
 * reason, which is how a bad extractor prompt shows up as "40% rejected as verbatim" rather
 * than as a vague drop in quality.
 */

export interface GateCandidate {
  statement: string;
  body?: string | null;
  situations?: string[];
  exampleQueries?: string[];
  keywords?: string[];
  facets?: Record<string, string | string[]>;
  attributes?: Record<string, unknown>;
}

export type GateReason =
  | 'missing_statement'
  | 'statement_too_long'
  | 'body_too_long'
  | 'missing_facet'
  | 'invalid_facet'
  | 'missing_attribute'
  | 'invalid_attribute'
  | 'attribute_too_long'
  | 'attribution'
  | 'unresolved_reference'
  | 'verbatim'
  | 'injection';

export interface GateFinding {
  reason: GateReason;
  field?: string;
  detail?: string;
}

/**
 * Phrasing that credits a person or organisation. Chunks name no one: the decision is that
 * the library keeps meaning, never attributions.
 */
const ATTRIBUTION_PATTERNS: RegExp[] = [
  /\baccording to\b/i,
  /\b[Aa]s [A-Z][\w.-]*(?:\s+[A-Z][\w.-]*)*\s+(?:argues|argued|says|said|notes|noted|writes|wrote|puts it|suggests|suggested|recommends|observed|observes)\b/,
  /\bcoined by\b/i,
  /\b(?:in|from) (?:his|her|their) (?:work|research|study|writing)\b/i,
  /\bthe (?:author|authors|writer|writers)\b/i,
];

/**
 * References that only make sense next to the source. A chunk is retrieved alone — there is
 * no surrounding passage to fall back on — so it has to stand on its own.
 */
const UNRESOLVED_PATTERNS: RegExp[] = [
  /\bthis (?:approach|technique|method|pattern|framework|model|principle|idea|concept)\b/i,
  /\bthe above\b/i,
  /\bas (?:mentioned|described|discussed|shown|noted) (?:above|earlier|before|previously)\b/i,
  /\bthe (?:previous|following|next) (?:section|chapter|example|figure|table)\b/i,
  /\b(?:in )?this (?:document|section|chapter|guide)\b/i,
];

/**
 * Text that addresses a model or carries something executable. Uploaded documents are
 * untrusted input and these chunks end up inside Builder's and engineers' agents, so an
 * instruction smuggled in a document must not survive into a chunk.
 */
const INJECTION_PATTERNS: RegExp[] = [
  /\bignore (?:all |any |the )?(?:previous|prior|above) (?:instructions|prompts|messages)\b/i,
  /\bsystem prompt\b/i,
  /\byou are (?:an? |the )?(?:ai|assistant|language model|llm|chatbot)\b/i,
  /\b(?:as an ai|as a language model)\b/i,
  /\b(?:assistant|system|user):\s/i,
  /https?:\/\/\S+/i,
  /\bwww\.\S+\.\S+/i,
  /```/,
  /<\/?(?:script|iframe|system|instructions?)\b/i,
  /\b(?:curl|wget|rm -rf|sudo)\s/i,
];

function textFields(candidate: GateCandidate): Array<[string, string]> {
  const fields: Array<[string, string]> = [
    ['statement', candidate.statement ?? ''],
  ];
  if (candidate.body) fields.push(['body', candidate.body]);
  for (const [key, value] of Object.entries(candidate.attributes ?? {})) {
    if (typeof value === 'string') fields.push([`attributes.${key}`, value]);
    if (Array.isArray(value)) {
      value.forEach((v, i) => {
        if (typeof v === 'string') fields.push([`attributes.${key}[${i}]`, v]);
      });
    }
  }
  (candidate.situations ?? []).forEach((s, i) =>
    fields.push([`situations[${i}]`, s]),
  );
  return fields;
}

/** Schema, vocabulary and length checks against the collection's profile. */
export function checkSchema(
  profile: CollectionProfile,
  candidate: GateCandidate,
  options: { bodyMaxChars?: number; requireFacets?: boolean } = {},
): GateFinding[] {
  const findings: GateFinding[] = [];
  const statement = (candidate.statement ?? '').trim();
  if (!statement)
    findings.push({ reason: 'missing_statement', field: 'statement' });
  if (statement.length > profile.statementMaxChars) {
    findings.push({
      reason: 'statement_too_long',
      field: 'statement',
      detail: `${statement.length} > ${profile.statementMaxChars}`,
    });
  }
  if (
    options.bodyMaxChars &&
    (candidate.body ?? '').length > options.bodyMaxChars
  ) {
    findings.push({ reason: 'body_too_long', field: 'body' });
  }

  for (const [key, spec] of Object.entries(profile.facets)) {
    const raw = candidate.facets?.[key];
    const values =
      raw === undefined || raw === null ? [] : Array.isArray(raw) ? raw : [raw];
    if (!values.length) {
      if (spec.required && options.requireFacets !== false) {
        findings.push({ reason: 'missing_facet', field: key });
      }
      continue;
    }
    if (!spec.multi && values.length > 1) {
      findings.push({
        reason: 'invalid_facet',
        field: key,
        detail: 'one value expected',
      });
    }
    if (spec.values) {
      for (const v of values) {
        if (!spec.values.includes(v)) {
          findings.push({
            reason: 'invalid_facet',
            field: key,
            detail: String(v),
          });
        }
      }
    }
  }

  for (const [key, spec] of Object.entries(profile.attributes)) {
    const value = candidate.attributes?.[key];
    const empty =
      value === undefined ||
      value === null ||
      (typeof value === 'string' && !value.trim()) ||
      (Array.isArray(value) && value.length === 0);
    if (empty) {
      if (spec.required)
        findings.push({ reason: 'missing_attribute', field: key });
      continue;
    }
    if (
      spec.type === 'enum' &&
      (typeof value !== 'string' || !spec.values?.includes(value))
    ) {
      findings.push({
        reason: 'invalid_attribute',
        field: key,
        detail: String(value),
      });
    }
    if (spec.type === 'bool' && typeof value !== 'boolean') {
      findings.push({ reason: 'invalid_attribute', field: key });
    }
    if (spec.type === 'text[]' && !Array.isArray(value)) {
      findings.push({ reason: 'invalid_attribute', field: key });
    }
    if (spec.type === 'text' && typeof value !== 'string') {
      findings.push({ reason: 'invalid_attribute', field: key });
    }
    if (spec.maxChars) {
      const strings = Array.isArray(value) ? value : [value];
      if (
        strings.some((s) => typeof s === 'string' && s.length > spec.maxChars!)
      ) {
        findings.push({ reason: 'attribute_too_long', field: key });
      }
    }
  }
  return findings;
}

export function checkAttribution(candidate: GateCandidate): GateFinding[] {
  const findings: GateFinding[] = [];
  for (const [field, text] of textFields(candidate)) {
    if (ATTRIBUTION_PATTERNS.some((re) => re.test(text))) {
      findings.push({ reason: 'attribution', field });
    }
  }
  return findings;
}

export function checkUnresolvedReferences(
  candidate: GateCandidate,
): GateFinding[] {
  const findings: GateFinding[] = [];
  for (const [field, text] of textFields(candidate)) {
    if (UNRESOLVED_PATTERNS.some((re) => re.test(text))) {
      findings.push({ reason: 'unresolved_reference', field });
    }
  }
  return findings;
}

export function checkInjection(candidate: GateCandidate): GateFinding[] {
  const findings: GateFinding[] = [];
  const all: Array<[string, string]> = [
    ...textFields(candidate),
    ...(candidate.exampleQueries ?? []).map((q, i): [string, string] => [
      `exampleQueries[${i}]`,
      q,
    ]),
    ...(candidate.keywords ?? []).map((k, i): [string, string] => [
      `keywords[${i}]`,
      k,
    ]),
  ];
  for (const [field, text] of all) {
    if (INJECTION_PATTERNS.some((re) => re.test(text))) {
      findings.push({ reason: 'injection', field });
    }
  }
  return findings;
}

/** Lowercased word tokens, punctuation stripped, for the verbatim comparison. */
export function words(text: string): string[] {
  return (text ?? '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** Every run of `n` consecutive words in `text`, joined with single spaces. */
export function wordRuns(
  text: string,
  n: number = CL_VERBATIM_RUN_WORDS,
): Set<string> {
  const tokens = words(text);
  const runs = new Set<string>();
  for (let i = 0; i + n <= tokens.length; i++)
    runs.add(tokens.slice(i, i + n).join(' '));
  return runs;
}

/**
 * Reject any text field that shares a run of 8 words with the segment it came from. This is
 * what guarantees the library keeps meaning and not text: a paraphrase passes, a lifted
 * sentence does not. Pass the segment's runs in once per segment rather than recomputing.
 */
export function checkVerbatim(
  candidate: GateCandidate,
  segmentRuns: Set<string>,
  n: number = CL_VERBATIM_RUN_WORDS,
): GateFinding[] {
  const findings: GateFinding[] = [];
  for (const [field, text] of textFields(candidate)) {
    for (const run of wordRuns(text, n)) {
      if (segmentRuns.has(run)) {
        findings.push({ reason: 'verbatim', field, detail: run });
        break;
      }
    }
  }
  return findings;
}

/**
 * The full deterministic gate for a DISTILLED candidate. Authored chunks skip the verbatim,
 * attribution and unresolved-reference checks — their text is the point, and an
 * organisation's protocol may well say "call the duty manager as described above".
 */
export function runDeterministicGate(
  profile: CollectionProfile,
  candidate: GateCandidate,
  segmentRuns: Set<string>,
): GateFinding[] {
  return [
    ...checkSchema(profile, candidate),
    ...checkAttribution(candidate),
    ...checkUnresolvedReferences(candidate),
    ...checkVerbatim(candidate, segmentRuns),
    ...checkInjection(candidate),
  ];
}

/** The gate-lite for authored, imported and agent chunks. */
export function runAuthoredGate(
  profile: CollectionProfile,
  candidate: GateCandidate,
  options: { bodyMaxChars: number },
): GateFinding[] {
  return [
    ...checkSchema(profile, candidate, {
      bodyMaxChars: options.bodyMaxChars,
      // Enrichment fills missing facets for authored chunks; the admin needn't.
      requireFacets: false,
    }).filter((f) => f.reason !== 'missing_attribute'),
    ...checkInjection(candidate),
  ];
}

/** Findings that reject outright, versus ones a rewrite might fix. */
export const HARD_REJECT_REASONS: ReadonlySet<GateReason> = new Set<GateReason>(
  [
    'missing_statement',
    'verbatim',
    'injection',
    'invalid_facet',
    'invalid_attribute',
  ],
);

export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a?.length || a.length !== b?.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}
