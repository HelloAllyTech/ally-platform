/**
 * Stage 4 go-live requirements that are plain data: the safety terms an owner accepts, the way a
 * customer reaches a person (`humanContact`), and the fixed notice at the start of every chat.
 * Pure: no I/O.
 */

/** Bump when the terms text changes: owners accept again before their next go-live. */
export const SAFETY_TERMS_VERSION = '2026-11-23';

// COPY: needs approval
export const SAFETY_TERMS_TEXT = [
  'This assistant is AI. It must never pretend to be a person.',
  'People who use it may be in distress. When someone may be at risk, it sends crisis information and alerts your team. You cannot turn this off.',
  'Someone on your team will read and answer alerts, and customers are told how to reach a person.',
  'It must not give medical, legal or emergency instructions from memory. It refers people to a professional or a resource.',
  'If people under 18 may use it, you have told us, and it uses the strictest settings.',
  'Ally and the people you add may read conversations to keep people safe and to improve answers.',
].join('\n');

/** How a customer reaches a person at the organisation (go-live requires at least one). */
export interface HumanContact {
  phone?: string;
  email?: string;
  url?: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^https?:\/\/[^\s/$.?#].[^\s]*$/i;
/** At least ten digits once spaces, dashes, brackets and a leading + are dropped. */
const PHONE = /^\+?[\d\s()-]{10,24}$/;
const digits = (v: string) => v.replace(/\D/g, '');

/** The stored contact with only valid parts, or null when there is none. */
export function humanContactOf(
  settings: Record<string, unknown> | null | undefined,
): HumanContact | null {
  const raw = settings?.humanContact as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== 'object') return null;
  const out: HumanContact = {};
  if (typeof raw.phone === 'string' && validPhone(raw.phone))
    out.phone = raw.phone.trim();
  if (typeof raw.email === 'string' && EMAIL.test(raw.email.trim()))
    out.email = raw.email.trim();
  if (typeof raw.url === 'string' && URL_RE.test(raw.url.trim()))
    out.url = raw.url.trim();
  return Object.keys(out).length ? out : null;
}

function validPhone(value: string): boolean {
  const v = value.trim();
  return PHONE.test(v) && digits(v).length >= 10 && digits(v).length <= 15;
}

/** Why a written `humanContact` is refused, or null. Absent is fine (go-live asks for it). */
export function validateHumanContact(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value))
    return 'humanContact is { phone?, email?, url? }';
  const v = value as Record<string, unknown>;
  for (const key of Object.keys(v)) {
    if (!['phone', 'email', 'url'].includes(key))
      return 'humanContact is { phone?, email?, url? }';
  }
  if (
    v.phone !== undefined &&
    v.phone !== '' &&
    (typeof v.phone !== 'string' || !validPhone(v.phone))
  )
    return 'humanContact.phone is a phone number of at least ten digits';
  if (
    v.email !== undefined &&
    v.email !== '' &&
    (typeof v.email !== 'string' || !EMAIL.test(v.email.trim()))
  )
    return 'humanContact.email is an email address';
  if (
    v.url !== undefined &&
    v.url !== '' &&
    (typeof v.url !== 'string' || !URL_RE.test(v.url.trim()))
  )
    return 'humanContact.url is a web address starting with http:// or https://';
  return null;
}
