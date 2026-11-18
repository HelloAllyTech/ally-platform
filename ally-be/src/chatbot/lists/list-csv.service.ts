import { Injectable } from '@nestjs/common';
import { parse } from 'csv-parse/sync';
import { DataSource, EntityManager } from 'typeorm';
import { ListFieldType } from '../enum/list.enum';
import { relationTarget } from './list-fields';
import { LIMIT_WORDS, LIST_LIMITS } from './list-limits';
import { ListRecordsService } from './list-records.service';
import { ListRefusalCode, ListRefusalException, refuse } from './list-refusals';
import { LoadedList, loadList, TitleResolver } from './list-store';
import type { ListActor } from './list-types';

export interface ListImportResult {
  dry_run: boolean;
  rows: number;
  created: number;
  updated: number;
  /** One per refused row. `row` is the line in the file (the header is line 1). */
  errors: {
    row: number;
    code: ListRefusalCode;
    field?: string;
    message: string;
  }[];
}

const ROLLBACK = Symbol('list-import-dry-run');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXPORT_PAGE = 1_000;
/** Text a spreadsheet would run as a formula. Exported with a leading `'`, which import drops. */
const FORMULA = /^[=+\-@\t\r]/;

function cell(value: string): string {
  return /[",\r\n]/.test(value) || value !== value.trim()
    ? `"${value.replace(/"/g, '""')}"`
    : value;
}

/**
 * A list as CSV, and CSV into a list (chunk 5a). Export: a header of field keys after `id`; dates
 * as stored (ISO); a relation as its target's id. Import goes through the same engine as every
 * other write, so every rule applies, across rows too: a dry run reports each row's refusal and
 * saves nothing; a commit writes the rows that pass.
 */
@Injectable()
export class ListCsvService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly records: ListRecordsService,
  ) {}

  async export(chatbotId: string, listKey: string): Promise<string> {
    const m = this.dataSource.manager;
    const list = await loadList(m, chatbotId, listKey);
    if (!list) throw refuse.notFound();
    const fields = list.fields;
    const lines = [['id', ...fields.map((f) => f.key)].join(',')];
    let after = '00000000-0000-0000-0000-000000000000';
    for (;;) {
      const rows: { id: string; data: Record<string, unknown> }[] =
        await m.query(
          `SELECT id, data FROM collection_records
          WHERE collection_id = $1 AND chatbot_id = $2 AND deleted_at IS NULL AND id > $3
          ORDER BY id LIMIT ${EXPORT_PAGE}`,
          [list.collection.id, chatbotId, after],
        );
      for (const row of rows) {
        const values = fields.map((f) => {
          const value = row.data?.[f.key];
          if (value === null || value === undefined) return '';
          const text = String(value);
          const guarded =
            (f.type === ListFieldType.TEXT ||
              f.type === ListFieldType.LONG_TEXT) &&
            FORMULA.test(text)
              ? `'${text}`
              : text;
          return cell(guarded);
        });
        lines.push([row.id, ...values].join(','));
      }
      if (rows.length < EXPORT_PAGE) break;
      after = rows[rows.length - 1].id;
    }
    return lines.join('\r\n') + '\r\n';
  }

  /**
   * A row with an `id` updates that record as it is now; a row without one creates a record. An
   * empty cell clears a field on an update and leaves the default on a create. A relation cell
   * takes the target's id, or its title when exactly one live record (or contact name) matches.
   *
   * All rows run in one transaction with a savepoint each, holding each rule's list-wide lock, so
   * rows are checked against each other as well as against the list.
   */
  async import(
    chatbotId: string,
    listKey: string,
    actor: ListActor,
    file: Buffer,
    { commit = false } = {},
  ): Promise<ListImportResult> {
    if (file.length > LIST_LIMITS.csvBytes) {
      throw refuse.limitExceeded(LIMIT_WORDS.csvBytes);
    }
    let rows: Record<string, string>[];
    try {
      rows = parse(file.toString('utf8').replace(/^﻿/, ''), {
        columns: true,
        skip_empty_lines: true,
        relax_column_count: false,
      });
    } catch (err) {
      throw refuse.invalidValue(
        undefined,
        'The file',
        `it isn't readable CSV (${(err as Error).message})`,
      );
    }
    if (rows.length > LIST_LIMITS.csvRows)
      throw refuse.limitExceeded(LIMIT_WORDS.csvRows);

    const result: ListImportResult = {
      dry_run: !commit,
      rows: rows.length,
      created: 0,
      updated: 0,
      errors: [],
    };

    const work = async (m: EntityManager) => {
      const list = await loadList(m, chatbotId, listKey);
      if (!list) throw refuse.notFound();
      const columns = Object.keys(rows[0] ?? {});
      for (const column of columns) {
        if (column !== 'id' && !list.field(column)) {
          throw refuse.invalidValue(
            column,
            column,
            "this column isn't a field of the list",
          );
        }
      }
      const resolve = new RelationCells(m, chatbotId, list);
      for (const [i, row] of rows.entries()) {
        const line = i + 2;
        await m.query('SAVEPOINT list_import_row');
        try {
          const id = (row.id ?? '').trim();
          const values: Record<string, unknown> = {};
          for (const column of columns) {
            if (column === 'id') continue;
            const field = list.field(column)!;
            let text = row[column] ?? '';
            if (
              (field.type === ListFieldType.TEXT ||
                field.type === ListFieldType.LONG_TEXT) &&
              text.startsWith("'") &&
              FORMULA.test(text.slice(1))
            ) {
              text = text.slice(1);
            }
            if (text.trim() === '') {
              if (id) values[column] = null;
              continue;
            }
            values[column] =
              field.type === ListFieldType.RELATION
                ? await resolve.value(column, text.trim())
                : text;
          }
          const opts = { manager: m, lockMode: 'list' as const };
          if (id) {
            await this.records.update(
              chatbotId,
              listKey,
              actor,
              id,
              values,
              undefined,
              opts,
            );
            result.updated++;
          } else {
            await this.records.create(chatbotId, listKey, actor, values, opts);
            result.created++;
          }
          await m.query('RELEASE SAVEPOINT list_import_row');
        } catch (err) {
          await m.query('ROLLBACK TO SAVEPOINT list_import_row');
          if (!(err instanceof ListRefusalException)) throw err;
          const { code, field, message } = err.refusal;
          result.errors.push({
            row: line,
            code,
            ...(field ? { field } : {}),
            message,
          });
        }
      }
      if (!commit) throw ROLLBACK;
    };

    try {
      await this.dataSource.transaction(work);
    } catch (err) {
      if (err !== ROLLBACK) throw err;
    }
    return result;
  }
}

/** Turns a relation cell (an id, or a title) into the target's id. */
class RelationCells {
  private readonly byTitle = new Map<string, Map<string, string[]>>();

  constructor(
    private readonly m: EntityManager,
    private readonly chatbotId: string,
    private readonly list: LoadedList,
  ) {}

  async value(key: string, text: string): Promise<string> {
    if (UUID.test(text)) return text;
    const field = this.list.field(key)!;
    const titles = await this.titles(key);
    const ids = titles.get(text.toLowerCase()) ?? [];
    if (ids.length !== 1) {
      throw refuse.invalidValue(
        key,
        field.label,
        ids.length
          ? `more than one entry is called ${text}; use its id`
          : `no entry is called ${text}`,
      );
    }
    return ids[0];
  }

  private async titles(key: string): Promise<Map<string, string[]>> {
    const cached = this.byTitle.get(key);
    if (cached) return cached;
    const field = this.list.field(key)!;
    const to = relationTarget(field);
    const map = new Map<string, string[]>();
    const add = (title: string, id: string) => {
      const k = title.trim().toLowerCase();
      map.set(k, [...(map.get(k) ?? []), id]);
    };
    if (to === 'contact') {
      const rows: { id: string; display_name: string | null }[] =
        await this.m.query(
          `SELECT id, display_name FROM chatbot_contacts WHERE chatbot_id = $1 AND display_name IS NOT NULL`,
          [this.chatbotId],
        );
      for (const row of rows) add(row.display_name!, row.id);
    } else {
      const resolver = new TitleResolver(this.m, this.chatbotId);
      const target = await resolver.listByKey(to);
      if (target) {
        const rows: { id: string; data: Record<string, unknown> }[] =
          await this.m.query(
            `SELECT id, data FROM collection_records
            WHERE collection_id = $1 AND chatbot_id = $2 AND deleted_at IS NULL
            LIMIT ${LIST_LIMITS.csvRows * 4}`,
            [target.collection.id, this.chatbotId],
          );
        await resolver.preload(target, rows);
        for (const row of rows)
          add(await resolver.title(target, row.data), row.id);
      }
    }
    this.byTitle.set(key, map);
    return map;
  }
}
