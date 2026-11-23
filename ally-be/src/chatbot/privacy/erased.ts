/**
 * The placeholders written over erased content. The same values as the WhatsApp retention sweep
 * (`whatsapp-retention.service.ts`), so a row blanked by either path is skipped by the other.
 * Kept here so the chatbot module does not import from the WhatsApp module.
 */
export const ERASED_TEXT = '[erased]';
export const ERASED_PREFIX = 'erased:';

/** The default retention for anything with no chatbot (D11). */
export const ORPHAN_RETENTION_DAYS = 90;

/** Postgres through `query`: UPDATE/DELETE give [rows, count]; SELECT gives rows. */
export function affectedOf(result: unknown): number {
  if (Array.isArray(result) && result.length === 2 && Array.isArray(result[0]))
    return Number(result[1] ?? 0);
  return Array.isArray(result) ? result.length : 0;
}

export function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result) && Array.isArray(result[0]))
    return result[0] as T[];
  return Array.isArray(result) ? (result as T[]) : [];
}
