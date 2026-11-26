import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  MANUAL_AUTHOR_LABELS,
  MANUAL_CHANGES_DEFAULT_LIMIT,
  MANUAL_CHANGES_MAX_LIMIT,
} from '../constants/manual.constants';
import type { ChangeRow, ManualAuthorKind } from '../type/manual.types';

interface ChangeSqlRow {
  id: string;
  slug: string;
  pageTitle: string;
  at: Date | string;
  authorKind: ManualAuthorKind;
  reason: string | null;
  revertOf: string | null;
}

export function authorLabel(kind: string): string {
  return MANUAL_AUTHOR_LABELS[kind] ?? 'Staff';
}

/** The change log: `manual_revisions` read newest first, globally or for one page. */
@Injectable()
export class ManualChangesService {
  constructor(private readonly dataSource: DataSource) {}

  async list(
    opts: { slug?: string | null; limit?: number } = {},
  ): Promise<ChangeRow[]> {
    const limit = Math.min(
      Math.max(
        Math.floor(Number(opts.limit)) || MANUAL_CHANGES_DEFAULT_LIMIT,
        1,
      ),
      MANUAL_CHANGES_MAX_LIMIT,
    );
    const rows: ChangeSqlRow[] = await this.dataSource.query(
      `SELECT r.id,
              p.slug,
              p.title AS "pageTitle",
              r.created_at AS "at",
              r.author_kind AS "authorKind",
              r.reason,
              r.revert_of AS "revertOf"
         FROM manual_revisions r
         JOIN manual_pages p ON p.id = r.page_id
        WHERE p.deleted_at IS NULL
          AND ($1::varchar IS NULL OR p.slug = $1::varchar)
        ORDER BY r.created_at DESC, r.id
        LIMIT $2::int`,
      [opts.slug || null, limit],
    );
    return rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      pageTitle: row.pageTitle,
      at: new Date(row.at).toISOString(),
      authorKind: row.authorKind,
      authorLabel: authorLabel(row.authorKind),
      reason: row.reason ?? '',
      revertOf: row.revertOf ?? null,
    }));
  }
}
