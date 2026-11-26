import type { ManualImportPage } from "@types";

/** Pages per request. The server accepts up to 200; 90 keeps each request far under its 1 MB body limit. */
export const IMPORT_CHUNK_PAGES = 90;
/** A second guard for long pages: start a new request before the body nears the server's 1 MB limit. */
export const IMPORT_CHUNK_BYTES = 600_000;
export const IMPORT_MAX_PAGES = 1000;
export const IMPORT_MAX_FILE_BYTES = 8_000_000;

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export type ImportParse =
  | { ok: true; pages: ManualImportPage[] }
  | { ok: false; error: "notJson" | "shape" | "empty" | "tooMany" | "badPage"; position?: number };

/**
 * Reads an import file: either `{ "pages": [...] }` (what `bundle.json` is) or a bare list. Checks
 * only what a person can fix by looking at the file; the server checks the rest (secrets, size).
 * `position` is 1-based so it matches how a person counts.
 */
export const parseImportBundle = (text: string): ImportParse => {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: "notJson" };
  }
  const list = Array.isArray(data) ? data : (data as { pages?: unknown } | null)?.pages;
  if (!Array.isArray(list)) return { ok: false, error: "shape" };
  if (list.length === 0) return { ok: false, error: "empty" };
  if (list.length > IMPORT_MAX_PAGES) return { ok: false, error: "tooMany" };
  for (let i = 0; i < list.length; i += 1) {
    const page = list[i] as Partial<ManualImportPage> | null;
    const valid =
      !!page &&
      typeof page === "object" &&
      typeof page.slug === "string" &&
      page.slug.length <= 120 &&
      SLUG.test(page.slug) &&
      typeof page.title === "string" &&
      page.title.trim().length > 0;
    if (!valid) return { ok: false, error: "badPage", position: i + 1 };
  }
  return { ok: true, pages: list as ManualImportPage[] };
};

/** Splits pages into requests of at most `IMPORT_CHUNK_PAGES` pages and about `IMPORT_CHUNK_BYTES` bytes. */
export const chunkImportPages = (pages: ManualImportPage[]): ManualImportPage[][] => {
  const chunks: ManualImportPage[][] = [];
  let current: ManualImportPage[] = [];
  let bytes = 0;
  for (const page of pages) {
    const size = JSON.stringify(page).length;
    if (
      current.length > 0 &&
      (current.length >= IMPORT_CHUNK_PAGES || bytes + size > IMPORT_CHUNK_BYTES)
    ) {
      chunks.push(current);
      current = [];
      bytes = 0;
    }
    current.push(page);
    bytes += size;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
};
