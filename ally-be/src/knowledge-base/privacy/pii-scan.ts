/**
 * Personal-data detection on a chatbot's uploads and crawled pages (assistants build, stage 5).
 * Regex first, in code, at no cost: phone numbers, email addresses, Aadhaar-like and other
 * identity numbers. Names are left to the model scan (`KnowledgeReviewService`).
 *
 * Organisation contact details the owner marks public (a front-desk number, an info@ address)
 * are not findings. Findings keep only a masked sample, never the full value, so the review
 * screen and the database never hold a second copy of the personal data.
 */

export type PiiKind = 'phone' | 'email' | 'id_number' | 'name';

export interface PiiFinding {
  kind: PiiKind;
  /** Masked sample: first and last characters only. */
  sample: string;
  count: number;
}

export interface PiiScanResult {
  findings: PiiFinding[];
  total: number;
  /** TF1 F4: how many different phone numbers and email addresses were found. */
  distinctContacts: number;
}

/**
 * TF1 F4: an organisation's own document (a brochure, a handbook) lists its front desk, a
 * helpline and an info@ address. Up to this many different phone numbers and emails, with no
 * identity numbers, read as its published contacts, not as a list of people.
 */
export const ORG_CONTACTS_MAX = 4;

/** Whether a scan found only a few contact details: the organisation's own, not held. */
export function onlyOrganisationContacts(result: PiiScanResult): boolean {
  return (
    result.findings.every((f) => f.kind === 'phone' || f.kind === 'email') &&
    result.distinctContacts <= ORG_CONTACTS_MAX
  );
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/** 10+ digits, optionally with +, spaces, dashes, dots or brackets between them. */
const PHONE = /(?:\+?\d[\d\s().-]{8,}\d)/g;
/** Aadhaar-like: 12 digits in groups of four (the first digit is never 0 or 1). */
const AADHAAR = /\b[2-9]\d{3}[\s-]?\d{4}[\s-]?\d{4}\b/g;
/** PAN (India): five letters, four digits, a letter. */
const PAN = /\b[A-Z]{5}\d{4}[A-Z]\b/g;
/** Passport-like: a letter and seven digits. */
const PASSPORT = /\b[A-Z][0-9]{7}\b/g;

const digitsOf = (v: string) => v.replace(/\D/g, '');

export function maskValue(value: string): string {
  const v = value.trim();
  if (v.length <= 4) return '*'.repeat(v.length);
  return `${v.slice(0, 2)}${'*'.repeat(Math.min(8, v.length - 4))}${v.slice(-2)}`;
}

/** Normalise an owner-marked public value for comparison. */
function publicKeys(publicValues: string[]): Set<string> {
  const keys = new Set<string>();
  for (const value of publicValues) {
    const v = value.trim().toLowerCase();
    if (!v) continue;
    keys.add(v);
    const d = digitsOf(v);
    if (d.length >= 8) keys.add(d.slice(-10));
  }
  return keys;
}

/**
 * The phone numbers and email addresses inside a free-text setting ("0800 123 4567, open 9am to
 * 9pm"), so an organisation's own contact details can be passed as `publicValues`.
 */
export function contactValuesIn(text: string | null | undefined): string[] {
  const body = text ?? '';
  return [...(body.match(EMAIL) ?? []), ...(body.match(PHONE) ?? [])];
}

/**
 * TF1 round 2, N-3 (Sahyog's own PDF was held for its centre numbers, complaints email and
 * centre manager): contact details the document gives as the organisation's own are not personal
 * data. An address of a shared mailbox (info@, feedback@) or on the organisation's own domain,
 * and a number or address the sentence presents as a centre's, an office's or "ours", when the
 * sentence gives only that one. A list of numbers in one sentence is never waved through.
 */
const ORG_CUE =
  /\b(?:centre|center|office|branch|helpline|hotline|reception|front desk|call us|contact us|write to us|reach us|email us|whatsapp us|our (?:number|phone|email|helpline|office|centre|center|team))\b/i;
const ROLE_MAILBOX =
  /^(?:info|contact|contactus|hello|help|helpdesk|support|feedback|complaints?|enquir(?:y|ies)|inquir(?:y|ies)|office|admin|team|care|connect|listen|reception|desk|services?|grievances?)$/i;

/** The sentence (or line) around a match. */
function sentenceAt(body: string, index: number, length: number): string {
  const before = body.slice(0, index);
  const start = Math.max(
    before.lastIndexOf('\n'),
    ...['. ', '! ', '? ', '; '].map((s) => before.lastIndexOf(s)),
  );
  const after = body.slice(index + length);
  const ends = ['\n', '. ', '! ', '? ', '; ']
    .map((s) => after.indexOf(s))
    .filter((i) => i >= 0);
  const end = index + length + (ends.length ? Math.min(...ends) : after.length);
  return body.slice(start + 1, end);
}

const domainOf = (email: string) => email.toLowerCase().split('@')[1] ?? '';

/**
 * TF1 round 2, N-3: a person named in a public staff role ("the centre manager, Ms. Kavita
 * Meena", "Dr Rao, our dentist") is the organisation's contact, not a private individual.
 */
const ROLE =
  '(?:manager|director|head|co-?ordinator|officer|secretary|founder|chair(?:person|man|woman)?|trustee|principal|in-?charge|president|treasurer|counsell?or|doctor|caseworker|social worker|nurse|dentist|teacher|lawyer|advocate|therapist|psychologist|physiotherapist|administrator|superintendent|registrar|contact person|spokesperson|ceo|coo|cfo)';
const HONORIFIC = '(?:(?:mr|mrs|ms|miss|dr|shri|smt|prof)\\.?\\s+)';
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function inPublicRole(text: string, name: string): boolean {
  const bare = name
    .trim()
    .replace(new RegExp(`^${HONORIFIC}`, 'i'), '')
    .trim();
  if (bare.length < 3) return false;
  const n = escape(bare).replace(/\s+/g, '\\s+');
  const before = new RegExp(
    `\\b${ROLE}\\b[\\s,:–—-]{1,4}${HONORIFIC}?${n}\\b`,
    'i',
  );
  const after = new RegExp(
    `\\b${HONORIFIC}?${n}\\b\\s*[,(–—-]\\s*(?:(?:is|who is)\\s+)?(?:our|the)?\\s*(?:[\\w-]+\\s+){0,2}${ROLE}\\b`,
    'i',
  );
  const all = new RegExp(`\\b${n}\\b`, 'gi');
  const occurrences = [...text.matchAll(all)].length;
  if (!occurrences) return false;
  // Every mention must be in its role: one mention elsewhere could be private.
  const inRole =
    [...text.matchAll(new RegExp(before.source, 'gi'))].length +
    [...text.matchAll(new RegExp(after.source, 'gi'))].length;
  return inRole >= occurrences;
}

/** The regex scan. `publicValues`: contact details the owner marked public, never findings. */
export function scanForPii(
  text: string,
  publicValues: string[] = [],
): PiiScanResult {
  const allowed = publicKeys(publicValues);
  const orgDomains = new Set(
    publicValues.filter((v) => v.includes('@')).map(domainOf),
  );
  const found = new Map<string, PiiFinding>();
  const add = (kind: PiiKind, value: string) => {
    const key = `${kind}:${value}`;
    const prior = found.get(key);
    if (prior) prior.count += 1;
    else found.set(key, { kind, sample: maskValue(value), count: 1 });
  };
  const body = text ?? '';
  const ids = new Set<string>();
  for (const m of body.match(AADHAAR) ?? []) {
    ids.add(digitsOf(m));
    add('id_number', m);
  }
  for (const m of [
    ...(body.match(PAN) ?? []),
    ...(body.match(PASSPORT) ?? []),
  ]) {
    add('id_number', m);
  }
  // N-3: one contact of a kind in a sentence that presents it as the organisation's.
  const theOrganisations = (m: RegExpMatchArray, kind: RegExp) => {
    const sentence = sentenceAt(body, m.index ?? 0, m[0].length);
    const same = (sentence.match(kind) ?? []).filter(
      (v) => kind !== PHONE || digitsOf(v).length >= 10,
    );
    return same.length === 1 && ORG_CUE.test(sentence);
  };
  for (const m of body.matchAll(EMAIL)) {
    const email = m[0].toLowerCase();
    if (allowed.has(email)) continue;
    if (ROLE_MAILBOX.test(email.split('@')[0])) continue;
    if (orgDomains.has(domainOf(email))) continue;
    if (theOrganisations(m, EMAIL)) continue;
    add('email', email);
  }
  for (const m of body.matchAll(PHONE)) {
    const d = digitsOf(m[0]);
    if (d.length < 10 || d.length > 13) continue;
    if (ids.has(d)) continue;
    if (allowed.has(d.slice(-10))) continue;
    if (theOrganisations(m, PHONE)) continue;
    add('phone', d);
  }
  const findings = [...found.values()];
  const distinctContacts = [...found.keys()].filter(
    (k) => k.startsWith('phone:') || k.startsWith('email:'),
  ).length;
  // One finding per kind for the screen, with the total count and the first masked sample.
  const byKind = new Map<PiiKind, PiiFinding>();
  for (const f of findings) {
    const prior = byKind.get(f.kind);
    if (prior) prior.count += f.count;
    else byKind.set(f.kind, { ...f });
  }
  const merged = [...byKind.values()];
  return {
    findings: merged,
    total: merged.reduce((n, f) => n + f.count, 0),
    distinctContacts,
  };
}
