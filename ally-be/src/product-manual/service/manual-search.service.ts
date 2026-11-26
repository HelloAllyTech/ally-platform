import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  MANUAL_SEARCH_DEFAULT_LIMIT,
  MANUAL_SEARCH_MAX_CHARS,
  MANUAL_SEARCH_MAX_LIMIT,
  MANUAL_SEARCH_MIN_CHARS,
} from '../constants/manual.constants';
import type { SearchHit } from '../type/manual.types';

/** Private highlight markers: control characters never occur in a page, so they cannot be forged. */
const START = '\u0001';
const STOP = '\u0002';

/**
 * The text handed to ts_headline, with markdown stripped so a snippet reads as prose: `[[slug|label]]`
 * becomes the label, `[[slug]]` the slug, bold / code markers and leading `#`s go, table pipes become
 * spaces and whitespace collapses to single spaces. Applies to the headline input only, never to the
 * stored text or the tsvector (a generated column).
 */
const HEADLINE_TEXT_SQL = [
  'btrim(regexp_replace(',
  'regexp_replace(',
  'regexp_replace(',
  'regexp_replace(',
  'regexp_replace(',
  'regexp_replace(',
  "hits.summary || E'\\n' || hits.body,",
  // [[slug|label]] -> label
  "'\\[\\[[^\\]|]*\\|([^\\]]*)\\]\\]', '\\1', 'g'),",
  // [[slug]] -> slug
  "'\\[\\[([^\\]]*)\\]\\]', '\\1', 'g'),",
  // bold, underline-bold and code markers
  "'\\*\\*|__|[' || chr(96) || ']', '', 'g'),",
  // leading #s of a heading line
  "'(^|\\n)[ \\t]*#+[ \\t]*', '\\1', 'g'),",
  // table pipes
  "'\\|', ' ', 'g'),",
  // whitespace and newlines
  "'\\s+', ' ', 'g'))",
].join('\n');

const HEADLINE_OPTIONS = `StartSel=${START}, StopSel=${STOP}, MaxFragments=1, MaxWords=24, MinWords=8`;

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

/**
 * A `ts_headline` fragment as safe HTML: ts_headline is asked to wrap hits in private markers, the
 * whole fragment is HTML-escaped, and only then are the markers turned into `<mark>` tags. Whatever a
 * page contains, `<mark>` and `</mark>` are the only tags that can survive.
 */
export function highlightToHtml(fragment: string): string {
  return escapeHtml(fragment ?? '')
    .split(START)
    .join('<mark>')
    .split(STOP)
    .join('</mark>');
}

interface HitRow {
  slug: string;
  title: string;
  parentTitle: string | null;
  headline: string | null;
  summary: string | null;
  rank: number | string | null;
}

/** Full-text search over live pages: `websearch_to_tsquery`, ranked with `ts_rank_cd`. */
@Injectable()
export class ManualSearchService {
  constructor(private readonly dataSource: DataSource) {}

  async search(q: string, limit?: number): Promise<SearchHit[]> {
    const text = (typeof q === 'string' ? q : '')
      .trim()
      .slice(0, MANUAL_SEARCH_MAX_CHARS);
    if (text.length < MANUAL_SEARCH_MIN_CHARS) return [];
    const take = Math.min(
      Math.max(Math.floor(Number(limit)) || MANUAL_SEARCH_DEFAULT_LIMIT, 1),
      MANUAL_SEARCH_MAX_LIMIT,
    );

    const [{ n }] = (await this.dataSource.query(
      `SELECT numnode(websearch_to_tsquery('english', $1::text)) AS n`,
      [text],
    )) as { n: number | string }[];

    const rows: HitRow[] =
      Number(n) > 0
        ? await this.dataSource.query(
            `SELECT hits.slug, hits.title, hits."parentTitle", hits.summary, hits.rank,
                    ts_headline(
                      'english',
                      ${HEADLINE_TEXT_SQL},
                      hits.query,
                      $3::text
                    ) AS headline
               FROM (
                 SELECT p.slug, p.title, parent.title AS "parentTitle", p.summary, p.body,
                        ts_rank_cd(p.search_vector, q.query) AS rank, q.query AS query
                   FROM manual_pages p
                  CROSS JOIN (SELECT websearch_to_tsquery('english', $1::text) AS query) q
                   LEFT JOIN manual_pages parent
                     ON parent.slug = p.parent_slug AND parent.deleted_at IS NULL
                  WHERE p.deleted_at IS NULL AND p.search_vector @@ q.query
                  ORDER BY rank DESC, p.title
                  LIMIT $2::int
               ) hits
              ORDER BY hits.rank DESC, hits.title`,
            [text, take, HEADLINE_OPTIONS],
          )
        : // Only stop-words ("the", "and"): fall back to a title match.
          await this.dataSource.query(
            `SELECT p.slug, p.title, parent.title AS "parentTitle", p.summary,
                    NULL AS headline, 0 AS rank
               FROM manual_pages p
               LEFT JOIN manual_pages parent
                 ON parent.slug = p.parent_slug AND parent.deleted_at IS NULL
              WHERE p.deleted_at IS NULL AND p.title ILIKE $1::text ESCAPE '\\'
              ORDER BY p.title
              LIMIT $2::int`,
            [`%${text.replace(/[\\%_]/g, '\\$&')}%`, take],
          );

    return rows.map((row) => ({
      slug: row.slug,
      title: row.title,
      parentTitle: row.parentTitle ?? null,
      snippet: highlightToHtml(row.headline || (row.summary ?? '')),
      rank: Number(row.rank) || 0,
    }));
  }
}
