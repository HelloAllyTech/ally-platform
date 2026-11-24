/**
 * The public-repo scrubber (plan §8, docs/pm-agent.md "Principles").
 *
 * Compiled PRDs, plan.md files, issues and pull requests built from a card land in a
 * PUBLIC repository. Whatever the card says, what leaves the platform must be aggregate
 * and anonymised: no tenant names, no user content, no contact details, no credentials,
 * no internal hosts. Deterministic — a regex pass, not a model — so a test can prove it.
 *
 * Over-redaction is the accepted failure mode: a PRD that says "[redacted]" where it
 * did not need to is a small loss; a leaked tenant name or token is not recoverable.
 */

export const REDACTED = {
  EMAIL: '[email]',
  PHONE: '[phone]',
  SECRET: '[secret]',
  URL: '[internal-url]',
  IP: '[ip]',
  ID: '[id]',
  ORG: '[organisation]',
  QUOTE: '[user content]',
} as const;

const SECRET_PATTERNS: RegExp[] = [
  // Provider keys and tokens with recognisable prefixes.
  /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bASIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}\b/g,
  /\bphc_[A-Za-z0-9]{20,}\b/g,
  // JWTs.
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  // Authorization headers.
  /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/gi,
  // key=value / key: value credentials.
  /\b(?:api[_-]?key|secret|token|password|passwd|pwd|access[_-]?key|private[_-]?key)\b\s*[:=]\s*["']?[^\s"',;]{6,}/gi,
  // PEM blocks.
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  // Long hex / base64 blobs (hashes, keys) — 32+ chars with no spaces.
  /\b[a-f0-9]{32,}\b/gi,
  // Mixed-case-with-digits runs only, and no `/`, so a long file path is not mistaken
  // for a key.
  /\b(?=[A-Za-z0-9+]*\d)(?=[A-Za-z0-9+]*[A-Z])(?=[A-Za-z0-9+]*[a-z])[A-Za-z0-9+]{40,}={0,2}/g,
];

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// +91 98765 43210, 98765-43210, (555) 123-4567, +1 555 123 4567 …
const PHONE =
  /(?:\+\d{1,3}[\s-]?)?(?:\(\d{2,4}\)\s?|\d{2,5}[\s-]?)?\d{3,5}[\s-]?\d{4,5}\b/g;
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const UUID =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
// Internal hosts: our own non-public domains and anything with a query string (which
// is where ids and tokens travel). Public docs hosts are left alone.
const INTERNAL_URL =
  /\bhttps?:\/\/(?:[^\s/)]*\.)?(?:helloally\.dev|internal|local|localhost|amazonaws\.com|rds\.|posthog[a-z]*\.)[^\s)]*/gi;
const URL_WITH_QUERY = /\bhttps?:\/\/[^\s?)]+\?[^\s)]+/gi;
// "tenant: Acme", "organisation=Acme Health", "org 'Acme'" — the name after the label.
const LABELLED_ORG =
  /\b(tenant|organi[sz]ation|org|client|customer|partner)(\s*(?:name|id)?\s*[:=]\s*|\s+)(["'“‘][^"'”’]{1,80}["'”’]|[A-Z][\w&.-]*(?:\s+[A-Z][\w&.-]*){0,3})/g;
// Quoted speech longer than a few words reads as user content (a learner's words, a
// transcript line). Short quoted labels ("Start", "Accept & build") are kept.
const LONG_QUOTE = /["“][^"”\n]{40,}["”]/g;

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export interface ScrubOptions {
  /** Organisation / tenant names known to the platform; matched case-insensitively. */
  tenantNames?: string[];
}

/**
 * The platform's own names. Ally's own organisation is a row in `tenants`, so without this every
 * repo name and path (`ally-be`, `ally-web/apps/ally-admin-dashboard/…`) and every mention of the
 * product was redacted as a customer name, and the PM Agent's gate refused every recommendation
 * (prod 2026-11-24). The product's name is public; it is never a tenant to hide.
 */
const PLATFORM_OWN_NAMES = new Set(['ally', 'helloally', 'hello ally']);

/** Tenant names to redact: every tenant except the platform's own organisation. */
export function customerTenantNames(names: readonly string[]): string[] {
  return names.filter(
    (name) =>
      !PLATFORM_OWN_NAMES.has(name.trim().toLowerCase().replace(/\s+/g, ' ')),
  );
}

/** One named redaction rule. Order matters for the redacted output, not for detection. */
interface ScrubRule {
  name: ScrubRuleName;
  apply: (text: string, options: ScrubOptions) => string;
}

export type ScrubRuleName =
  | 'tenant_name'
  | 'private_key'
  | 'internal_url'
  | 'url_with_query'
  | 'email'
  | 'id'
  | 'secret'
  | 'ip'
  | 'phone'
  | 'labelled_org'
  | 'long_quote';

const tenantNameRule = (text: string, options: ScrubOptions): string => {
  // Named tenants first, longest first so "Acme Health" wins over "Acme".
  const names = [...new Set((options.tenantNames ?? []).map((n) => n.trim()))]
    .filter((name) => name.length >= 3)
    .sort((a, b) => b.length - a.length);
  let out = text;
  for (const name of names) {
    out = out.replace(
      new RegExp(`(?<![\\w])${escapeRegExp(name)}(?![\\w])`, 'gi'),
      REDACTED.ORG,
    );
  }
  return out;
};

const SCRUB_RULES: ScrubRule[] = [
  { name: 'tenant_name', apply: tenantNameRule },
  {
    name: 'private_key',
    apply: (t) =>
      t.replace(/-----BEGIN [\s\S]*?-----END [A-Z ]*-----/g, REDACTED.SECRET),
  },
  { name: 'internal_url', apply: (t) => t.replace(INTERNAL_URL, REDACTED.URL) },
  {
    name: 'url_with_query',
    apply: (t) => t.replace(URL_WITH_QUERY, REDACTED.URL),
  },
  { name: 'email', apply: (t) => t.replace(EMAIL, REDACTED.EMAIL) },
  { name: 'id', apply: (t) => t.replace(UUID, REDACTED.ID) },
  {
    name: 'secret',
    apply: (t) =>
      SECRET_PATTERNS.reduce(
        (out, pattern) => out.replace(pattern, REDACTED.SECRET),
        t,
      ),
  },
  { name: 'ip', apply: (t) => t.replace(IPV4, REDACTED.IP) },
  {
    name: 'phone',
    apply: (t) =>
      t.replace(PHONE, (match) =>
        // Leave plain numbers (percentages, counts, years): a phone has 10+ digits.
        match.replace(/\D/g, '').length >= 10 ? REDACTED.PHONE : match,
      ),
  },
  {
    name: 'labelled_org',
    apply: (t) =>
      t.replace(
        LABELLED_ORG,
        (_match, label: string, sep: string) => `${label}${sep}${REDACTED.ORG}`,
      ),
  },
  { name: 'long_quote', apply: (t) => t.replace(LONG_QUOTE, REDACTED.QUOTE) },
];

/** Every rule: what a PUBLISHED text (the roadmap entry) must pass. */
export const PUBLIC_SCRUB_RULES: readonly ScrubRuleName[] = SCRUB_RULES.map(
  (rule) => rule.name,
);

/**
 * Real leaks only: what an admin-only text must still never carry. The pattern rules that
 * misfire on code-like text (ids, IPs, long digit runs read as phones, labelled names, long
 * quotes) are left out: a build plan names migrations, ids and paths.
 */
export const LEAK_SCRUB_RULES: readonly ScrubRuleName[] = [
  'tenant_name',
  'private_key',
  'internal_url',
  'url_with_query',
  'email',
  'secret',
];

/** Scrub one string for a public repo. */
export function scrubForPublic(
  text: string,
  options: ScrubOptions = {},
): string {
  if (!text) return text;
  return SCRUB_RULES.reduce((out, rule) => rule.apply(out, options), text);
}

/** The rules (of `only`, default all) that would change this text. Empty = clean. */
export function scrubHits(
  text: string,
  options: ScrubOptions = {},
  only: readonly ScrubRuleName[] = PUBLIC_SCRUB_RULES,
): ScrubRuleName[] {
  if (!text) return [];
  return SCRUB_RULES.filter(
    (rule) => only.includes(rule.name) && rule.apply(text, options) !== text,
  ).map((rule) => rule.name);
}

/** Scrub every string in a JSON-like value (arrays and plain objects), returning a copy. */
export function scrubDeep<T>(value: T, options: ScrubOptions = {}): T {
  if (typeof value === 'string') return scrubForPublic(value, options) as T;
  if (Array.isArray(value))
    return value.map((item) => scrubDeep(item, options)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        scrubDeep(item, options),
      ]),
    ) as T;
  }
  return value;
}
