import { parse } from 'csv-parse/sync';
import {
  CL_BODY_MAX_CHARS,
  CL_BULK_MAX_ROWS,
} from '../constants/context-library.constants';
import { CollectionProfile } from '../profiles/profile.types';
import { normaliseTag } from '../profiles/profile.util';
import { GateCandidate, runAuthoredGate } from './gate.util';

/**
 * Parsing for bulk uploads of authored chunks.
 *
 * One row per chunk, columns named after the profile's fields (a template per collection is
 * served alongside). List cells are split on `|`. Every row is checked independently, so a
 * bad row is reported and skipped instead of failing the file — the admin sees "row 7: body
 * too long" in the dry run and fixes it in the file.
 */
export interface AuthoredChunkInput extends GateCandidate {
  code?: string;
  situations: string[];
  exampleQueries: string[];
  keywords: string[];
  topics: string[];
  facets: Record<string, string | string[]>;
  attributes: Record<string, unknown>;
  isGlobal?: boolean;
  tenantIds?: string[];
  pinned?: boolean;
  citation?: {
    title: string;
    sectionPath?: string | null;
    pageFrom?: number;
    pageTo?: number;
  } | null;
}

export interface BulkParseResult {
  rows: Array<{ row: number; input: AuthoredChunkInput }>;
  rejected: Array<{ row: number; reason: string }>;
}

const CORE_COLUMNS = [
  'code',
  'statement',
  'body',
  'situations',
  'example_queries',
  'keywords',
  'topics',
  'is_global',
  'tenant_ids',
  'pinned',
  'citation_title',
  'citation_section',
  'citation_page_from',
  'citation_page_to',
] as const;

/** The columns a collection's template has, in order. */
export function templateColumns(profile: CollectionProfile): string[] {
  return [
    ...CORE_COLUMNS,
    ...Object.keys(profile.facets),
    ...Object.keys(profile.attributes),
  ];
}

export function templateCsv(profile: CollectionProfile): string {
  return `${templateColumns(profile).join(',')}\n`;
}

function list(value: unknown): string[] {
  if (Array.isArray(value))
    return value.map((v) => String(v).trim()).filter(Boolean);
  if (value === undefined || value === null) return [];
  return String(value)
    .split('|')
    .map((v) => v.trim())
    .filter(Boolean);
}

function text(value: unknown): string {
  return value === undefined || value === null ? '' : String(value).trim();
}

function bool(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  const t = text(value).toLowerCase();
  if (!t) return undefined;
  if (['true', 'yes', '1', 'y'].includes(t)) return true;
  if (['false', 'no', '0', 'n'].includes(t)) return false;
  return undefined;
}

function int(value: unknown): number | undefined {
  const n = Number(text(value));
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

/** Map one raw row (CSV strings or JSON values) onto a chunk input. */
export function rowToInput(
  profile: CollectionProfile,
  raw: Record<string, unknown>,
): AuthoredChunkInput {
  const facets: Record<string, string | string[]> = {};
  for (const [key, spec] of Object.entries(profile.facets)) {
    const values = list(raw[key]).map((v) =>
      spec.values ? v : normaliseTag(v),
    );
    if (!values.length) continue;
    facets[key] = spec.multi ? values : values[0];
  }

  const attributes: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(profile.attributes)) {
    if (raw[key] === undefined || raw[key] === null || raw[key] === '')
      continue;
    if (spec.type === 'text[]') attributes[key] = list(raw[key]);
    else if (spec.type === 'bool') attributes[key] = bool(raw[key]);
    else attributes[key] = text(raw[key]);
  }

  const citationTitle = text(raw.citation_title);
  return {
    code: text(raw.code) || undefined,
    statement: text(raw.statement),
    body: text(raw.body) || null,
    situations: list(raw.situations),
    exampleQueries: list(raw.example_queries),
    keywords: list(raw.keywords),
    topics: list(raw.topics).map(normaliseTag),
    facets,
    attributes,
    isGlobal: bool(raw.is_global),
    tenantIds: list(raw.tenant_ids),
    pinned: bool(raw.pinned),
    citation: citationTitle
      ? {
          title: citationTitle,
          sectionPath: text(raw.citation_section) || null,
          pageFrom: int(raw.citation_page_from),
          pageTo: int(raw.citation_page_to),
        }
      : null,
  };
}

export function parseBulkFile(
  profile: CollectionProfile,
  fileName: string,
  buffer: Buffer,
): BulkParseResult {
  let rawRows: Record<string, unknown>[];
  const isJson =
    /\.json$/i.test(fileName) ||
    buffer.toString('utf-8', 0, 64).trimStart().startsWith('[');
  try {
    if (isJson) {
      const parsed = JSON.parse(buffer.toString('utf-8'));
      if (!Array.isArray(parsed))
        throw new Error('expected a JSON array of objects');
      rawRows = parsed;
    } else {
      rawRows = parse(buffer.toString('utf-8'), {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        bom: true,
      });
    }
  } catch (error) {
    throw new Error(
      `Could not read the file: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (rawRows.length > CL_BULK_MAX_ROWS) {
    throw new Error(
      `The file has ${rawRows.length} rows; the limit is ${CL_BULK_MAX_ROWS}.`,
    );
  }

  const result: BulkParseResult = { rows: [], rejected: [] };
  rawRows.forEach((raw, i) => {
    // Row numbers as a spreadsheet shows them: the header is row 1.
    const row = isJson ? i + 1 : i + 2;
    if (!raw || typeof raw !== 'object') {
      result.rejected.push({ row, reason: 'not an object' });
      return;
    }
    const input = rowToInput(profile, raw);
    const findings = runAuthoredGate(profile, input, {
      bodyMaxChars: CL_BODY_MAX_CHARS,
    });
    if (findings.length) {
      result.rejected.push({
        row,
        reason: findings
          .map(
            (f) =>
              `${f.reason.replace(/_/g, ' ')}${f.field ? ` (${f.field})` : ''}${f.detail ? `: ${f.detail}` : ''}`,
          )
          .join('; '),
      });
      return;
    }
    result.rows.push({ row, input });
  });
  return result;
}
