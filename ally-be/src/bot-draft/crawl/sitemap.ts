import { XMLParser } from 'fast-xml-parser';

/** The page URLs in a sitemap, or the child sitemaps of a sitemap index (one level). */
export function parseSitemap(xml: string): {
  pages: string[];
  sitemaps: string[];
} {
  let doc: Record<string, unknown>;
  try {
    doc = new XMLParser({ ignoreAttributes: true }).parse(xml) as Record<
      string,
      unknown
    >;
  } catch {
    return { pages: [], sitemaps: [] };
  }
  const list = <T>(value: T | T[] | undefined): T[] =>
    value === undefined ? [] : Array.isArray(value) ? value : [value];
  const urlset = doc.urlset as
    | { url?: { loc?: string } | { loc?: string }[] }
    | undefined;
  const index = doc.sitemapindex as
    | { sitemap?: { loc?: string } | { loc?: string }[] }
    | undefined;
  return {
    pages: list(urlset?.url)
      .map((u) => String(u?.loc ?? '').trim())
      .filter(Boolean),
    sitemaps: list(index?.sitemap)
      .map((s) => String(s?.loc ?? '').trim())
      .filter(Boolean),
  };
}
