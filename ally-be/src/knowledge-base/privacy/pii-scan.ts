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

/** The regex scan. `publicValues`: contact details the owner marked public, never findings. */
export function scanForPii(
  text: string,
  publicValues: string[] = [],
): PiiScanResult {
  const allowed = publicKeys(publicValues);
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
  for (const m of body.match(EMAIL) ?? []) {
    if (allowed.has(m.toLowerCase())) continue;
    add('email', m.toLowerCase());
  }
  for (const m of body.match(PHONE) ?? []) {
    const d = digitsOf(m);
    if (d.length < 10 || d.length > 13) continue;
    if (ids.has(d)) continue;
    if (allowed.has(d.slice(-10))) continue;
    add('phone', d);
  }
  const findings = [...found.values()];
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
  };
}
