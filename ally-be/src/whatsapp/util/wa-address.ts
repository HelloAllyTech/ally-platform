/**
 * WA-A §4 (RC1 §4b): who a WhatsApp contact is to Meta. A phone number (E.164 digits) when Meta
 * sent one, else their business-scoped user ID (`IN.1349…`: a country code, a dot, up to 128
 * letters and digits). Sends go to it (`to` for a phone, `recipient` for an ID), and rate limits,
 * the shared store's identity and the run's sender key on it.
 */
const BUSINESS_SCOPED_ID = /^[A-Z]{2}\.[A-Za-z0-9]{1,128}$/;

export const isBusinessScopedId = (value: string | null | undefined): boolean =>
  BUSINESS_SCOPED_ID.test(String(value ?? ''));

export function waAddressOf(contact: {
  phoneE164?: string | null;
  bsuid?: string | null;
}): string {
  return contact.phoneE164 || contact.bsuid || '';
}

/** The last 4 characters, for a masked label ("contact ending 3210"). */
export const lastFourOf = (address: string): string =>
  (address.replace(/[^A-Za-z0-9]/g, '').slice(-4) || '0000').padStart(4, '0');
