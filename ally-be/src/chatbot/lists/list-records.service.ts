import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { CollectionConstraint } from '../entity/collection-constraint.entity';
import { CollectionField } from '../entity/collection-field.entity';
import { CollectionRecord } from '../entity/collection-record.entity';
import { RecordEvent } from '../entity/record-event.entity';
import { RecordLink } from '../entity/record-link.entity';
import {
  ListConstraintKind,
  ListFieldType,
  RecordEventOp,
  RecordLinkTargetKind,
} from '../enum/list.enum';
import {
  CONTAINS_TYPES,
  maskValue,
  normaliseValue,
  RANGE_TYPES,
  relationTarget,
} from './list-fields';
import { LIMIT_WORDS, LIST_LIMITS } from './list-limits';
import { ListLock, ruleLock, takeLocks, valueLock } from './list-locks';
import { LIST_COPY, ListRefusalException, refuse } from './list-refusals';
import { matchesWhere, Sql, summable, whereSql } from './list-rules';
import { LoadedList, loadList, TitleResolver } from './list-store';
import {
  actorRef,
  CapacityConfig,
  isAgent,
  LimitPerPersonConfig,
  ListActor,
  ListQuery,
  ListQueryResult,
  ListRecordView,
  ListScope,
  ListWriteOptions,
  ListWriteResult,
  TransitionsConfig,
  UniqueConfig,
} from './list-types';

type Data = Record<string, unknown>;

interface RecordRow {
  id: string;
  collection_id: string;
  data: Data;
  contact_id: string | null;
  version: number;
  deleted_at: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const NO_RECORD = '00000000-0000-0000-0000-000000000000';
const ROLLBACK = Symbol('list-dry-run');
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const MAX_ALTERNATIVES = 3;

const iso = (d: Date | string | null | undefined): string | null =>
  d ? new Date(d).toISOString() : null;

/** Drops empty values: a cleared field is absent from `data`. */
function compact(data: Data): Data {
  return Object.fromEntries(
    Object.entries(data).filter(([, v]) => v !== null && v !== undefined),
  );
}

/** The text cast that orders and compares a field's values by type. */
function cast(field: CollectionField): string {
  switch (field.type) {
    case ListFieldType.NUMBER:
    case ListFieldType.MONEY:
    case ListFieldType.DURATION:
      return '::numeric';
    case ListFieldType.DATE:
      return '::date';
    case ListFieldType.DATETIME:
      return '::timestamptz';
    default:
      return '';
  }
}

/**
 * The lists engine (Agents v2, chunk 5a): every read and write of a list's records, for every
 * caller. The owner API, CSV import and the agent's tools (chunk 6) all come through here, so a
 * rule holds whoever writes.
 *
 * A write validates the input for its actor, then, in one transaction, locks the record (an
 * update), takes the rules' advisory locks in a fixed order, checks the rules, and writes the
 * record, its links and an event. A refusal is a `ListRefusalException` carrying
 * `{ code, field?, message, conflict? }`.
 */
@Injectable()
export class ListRecordsService {
  constructor(private readonly dataSource: DataSource) {}

  // ---- writes ---------------------------------------------------------------------------------

  create(
    chatbotId: string,
    listKey: string,
    actor: ListActor,
    input: Data,
    opts: ListWriteOptions = {},
  ): Promise<ListWriteResult> {
    return this.run(opts, async (m) => {
      const list = await this.list(m, chatbotId, listKey, 'share');
      const scope = this.scope(list, actor, opts);
      if (scope === null) throw refuse.notFound();
      this.assertAgentWrites(list, actor);
      const values = this.checkInput(list, actor, input, scope);

      const data: Data = {};
      for (const field of list.fields) {
        if (field.default !== null && field.default !== undefined) {
          data[field.key] = field.default;
        }
      }
      Object.assign(data, values);
      if (scope !== undefined) data[list.personField!.key] = scope;
      const record = compact(data);

      this.checkRequired(list, record);
      this.checkSize(record);
      await this.checkRelations(m, chatbotId, list, record);
      await this.checkRecordLimit(m, chatbotId);
      await this.enforceRules(m, chatbotId, list, actor, opts, record, null);

      const saved = await m.save(CollectionRecord, {
        chatbotId,
        collectionId: list.collection.id,
        data: record,
        contactId: this.personOf(list, record),
        createdBy: actorRef(actor),
        version: 1,
      });
      await this.writeLinks(m, list, saved.id, record);
      await this.event(m, saved.id, RecordEventOp.CREATE, null, record, actor);
      return { record: await this.view(m, chatbotId, list, actor, saved) };
    });
  }

  /**
   * Changes the given fields; `null` clears one. `version` is the version the caller read: a
   * stale one is refused. Left out (CSV import), the record is changed as it is now.
   */
  update(
    chatbotId: string,
    listKey: string,
    actor: ListActor,
    recordId: string,
    patch: Data,
    version: number | undefined,
    opts: ListWriteOptions = {},
  ): Promise<ListWriteResult> {
    return this.run(opts, async (m) => {
      const list = await this.list(m, chatbotId, listKey, 'share');
      const scope = this.scope(list, actor, opts);
      this.assertAgentWrites(list, actor);
      const row = await this.lockRow(
        m,
        chatbotId,
        list,
        recordId,
        scope,
        false,
      );
      if (version !== undefined && row.version !== version) {
        throw refuse.versionConflict();
      }
      const values = this.checkInput(list, actor, patch, scope);
      const record = compact({ ...row.data, ...values });

      this.checkRequired(list, record);
      this.checkSize(record);
      const changed = Object.fromEntries(
        Object.keys(values).map((k) => [k, record[k]]),
      );
      await this.checkRelations(m, chatbotId, list, changed);
      await this.enforceRules(m, chatbotId, list, actor, opts, record, row);

      await m.update(
        CollectionRecord,
        { id: row.id },
        {
          data: record as QueryDeepPartialEntity<Data>,
          contactId: this.personOf(list, record),
          version: row.version + 1,
        },
      );
      await this.writeLinks(m, list, row.id, record);
      await this.event(
        m,
        row.id,
        RecordEventOp.UPDATE,
        row.data,
        record,
        actor,
      );
      return {
        record: await this.view(m, chatbotId, list, actor, {
          ...this.entity(row),
          data: record,
          contactId: this.personOf(list, record),
          version: row.version + 1,
          updatedAt: new Date(),
        }),
      };
    });
  }

  delete(
    chatbotId: string,
    listKey: string,
    actor: ListActor,
    recordId: string,
    opts: ListWriteOptions & { version?: number } = {},
  ): Promise<ListWriteResult> {
    return this.run(opts, async (m) => {
      const list = await this.list(m, chatbotId, listKey, 'share');
      const scope = this.scope(list, actor, opts);
      this.assertAgentWrites(list, actor);
      const row = await this.lockRow(
        m,
        chatbotId,
        list,
        recordId,
        scope,
        false,
      );
      if (opts.version !== undefined && row.version !== opts.version) {
        throw refuse.versionConflict();
      }
      const deletedAt = new Date();
      await m.update(
        CollectionRecord,
        { id: row.id },
        { deletedAt, version: row.version + 1 },
      );
      await this.event(m, row.id, RecordEventOp.DELETE, row.data, null, actor);
      return {
        record: await this.view(m, chatbotId, list, actor, {
          ...this.entity(row),
          version: row.version + 1,
          deletedAt,
        }),
      };
    });
  }

  /** Brings a deleted record back, if every rule still holds and its relations are still live. */
  restore(
    chatbotId: string,
    listKey: string,
    actor: ListActor,
    recordId: string,
    opts: ListWriteOptions = {},
  ): Promise<ListWriteResult> {
    return this.run(opts, async (m) => {
      const list = await this.list(m, chatbotId, listKey, 'share');
      const scope = this.scope(list, actor, opts);
      this.assertAgentWrites(list, actor);
      const row = await this.lockRow(m, chatbotId, list, recordId, scope, true);
      const record = compact(row.data);
      this.checkRequired(list, record);
      await this.checkRelations(m, chatbotId, list, record);
      await this.checkRecordLimit(m, chatbotId);
      await this.enforceRules(m, chatbotId, list, actor, opts, record, null, {
        transitions: false,
      });
      await m.update(
        CollectionRecord,
        { id: row.id },
        { deletedAt: null, version: row.version + 1 },
      );
      await this.event(m, row.id, RecordEventOp.RESTORE, null, record, actor);
      return {
        record: await this.view(m, chatbotId, list, actor, {
          ...this.entity(row),
          version: row.version + 1,
          deletedAt: null,
        }),
      };
    });
  }

  // ---- reads ----------------------------------------------------------------------------------

  async get(
    chatbotId: string,
    listKey: string,
    actor: ListActor,
    recordId: string,
    opts: ListScope = {},
  ): Promise<ListRecordView> {
    const m = this.dataSource.manager;
    const list = await this.list(m, chatbotId, listKey);
    this.assertAgentReads(list, actor);
    const scope = this.scope(list, actor, opts);
    const [row]: RecordRow[] = await m.query(
      `SELECT * FROM collection_records
        WHERE id = $1 AND collection_id = $2 AND chatbot_id = $3 AND deleted_at IS NULL`,
      [recordId, list.collection.id, chatbotId],
    );
    if (!row || (scope !== undefined && row.contact_id !== scope)) {
      throw refuse.notFound();
    }
    return this.view(m, chatbotId, list, actor, this.entity(row));
  }

  /**
   * Filters (equals, contains, ranges), a sort, a cursor and a limit, with the count of matching
   * records or a sum over them. The agent sees only fields it may read, masked where set, and may
   * not filter or sort on a masked field (that would reveal it a guess at a time).
   */
  async query(
    chatbotId: string,
    listKey: string,
    actor: ListActor,
    q: ListQuery = {},
    opts: ListScope = {},
    manager: EntityManager = this.dataSource.manager,
  ): Promise<ListQueryResult> {
    const list = await this.list(manager, chatbotId, listKey);
    this.assertAgentReads(list, actor);
    const scope = this.scope(list, actor, opts);
    const limit = Math.min(
      Math.max(Math.trunc(q.limit ?? DEFAULT_LIMIT), 1),
      MAX_LIMIT,
    );
    if (scope === null) return { records: [], total: 0, next_cursor: null };

    const usable = (key: string): CollectionField => {
      const field = list.field(key);
      if (
        !field ||
        (isAgent(actor) &&
          (!this.agentReads(list, field) || field.privacy?.masked))
      ) {
        throw refuse.invalidValue(
          key,
          key,
          "it isn't a field you can use here",
        );
      }
      return field;
    };

    const sql = new Sql();
    const where: string[] = [
      `r.collection_id = ${sql.p(list.collection.id)}`,
      `r.chatbot_id = ${sql.p(chatbotId)}`,
    ];
    if (!(q.includeDeleted && !isAgent(actor)))
      where.push('r.deleted_at IS NULL');
    if (scope !== undefined) where.push(`r.contact_id = ${sql.p(scope)}`);

    for (const filter of q.filters ?? []) {
      const field = usable(filter.field);
      if (filter.op === 'eq') {
        const value = normaliseValue(field, filter.value);
        where.push(
          value === null
            ? `${sql.text(field.key, 'r.')} IS NULL`
            : `r.data @> ${sql.p(JSON.stringify({ [field.key]: value }))}::jsonb`,
        );
      } else if (filter.op === 'contains') {
        if (
          !CONTAINS_TYPES.has(field.type) ||
          typeof filter.value !== 'string'
        ) {
          throw refuse.invalidValue(
            field.key,
            field.label,
            "it can't be searched as text",
          );
        }
        const escaped = filter.value.replace(/[\\%_]/g, (c) => `\\${c}`);
        where.push(
          `${sql.text(field.key, 'r.')} ILIKE ${sql.p(`%${escaped}%`)} ESCAPE '\\'`,
        );
      } else if (filter.op === 'from' || filter.op === 'to') {
        if (!RANGE_TYPES.has(field.type)) {
          throw refuse.invalidValue(
            field.key,
            field.label,
            "it can't be filtered by a range",
          );
        }
        const value = normaliseValue(field, filter.value);
        if (value === null) continue;
        const c = cast(field);
        where.push(
          `${sql.text(field.key, 'r.')}${c} ${filter.op === 'from' ? '>=' : '<='} ${sql.p(value)}${c}`,
        );
      } else {
        throw refuse.invalidValue(
          undefined,
          'The filter',
          'use eq, contains, from or to',
        );
      }
    }

    // The count and sum run over the filters alone, with only their parameters.
    const filterParams = sql.params.length;
    const filterWhere = [...where];

    // The sort: a field (typed), or when the record was made; the id breaks ties.
    const spec = q.sort ?? list.collection.settings?.default_sort ?? '';
    const desc = spec.startsWith('-');
    const sortField = spec ? usable(spec.replace(/^-/, '')) : undefined;
    const sortExpr = sortField
      ? `${sql.text(sortField.key, 'r.')}${cast(sortField)}`
      : 'r."createdAt"';
    const sortCast = sortField ? cast(sortField) : '::timestamp';

    if (q.cursor) {
      let cursor: [string | null, string, string];
      try {
        cursor = JSON.parse(
          Buffer.from(q.cursor, 'base64url').toString('utf8'),
        );
      } catch {
        cursor = [null, '', ''];
      }
      if (
        !Array.isArray(cursor) ||
        cursor[2] !== spec ||
        typeof cursor[1] !== 'string'
      ) {
        throw refuse.invalidValue(
          undefined,
          'The cursor',
          'it belongs to another query',
        );
      }
      const [value, id] = cursor;
      const idParam = sql.p(id);
      if (value === null) {
        where.push(`(${sortExpr} IS NULL AND r.id > ${idParam}::uuid)`);
      } else {
        const v = `${sql.p(value)}${sortCast}`;
        where.push(
          `((${sortExpr} ${desc ? '<' : '>'} ${v}) OR (${sortExpr} = ${v} AND r.id > ${idParam}::uuid) OR ${sortExpr} IS NULL)`,
        );
      }
    }

    const rows: (RecordRow & { sort_value: string | null })[] =
      await manager.query(
        `SELECT r.*, (${sortExpr})::text AS sort_value FROM collection_records r
        WHERE ${where.join(' AND ')}
        ORDER BY ${sortExpr} ${desc ? 'DESC' : 'ASC'} NULLS LAST, r.id ASC
        LIMIT ${limit + 1}`,
        sql.params,
      );
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    const next_cursor =
      rows.length > limit && last
        ? Buffer.from(
            JSON.stringify([last.sort_value, last.id, spec]),
          ).toString('base64url')
        : null;

    const countParams = sql.params.slice(0, filterParams);
    let aggregate: ListQueryResult['aggregate'];
    let total: number;
    if (q.aggregate && q.aggregate !== 'count') {
      const key = q.aggregate.replace(/^sum:/, '');
      const field = usable(key);
      if (!q.aggregate.startsWith('sum:') || !summable(field)) {
        throw refuse.invalidValue(key, field.label, "it can't be added up");
      }
      countParams.push(field.key);
      const [row] = await manager.query(
        `SELECT count(*)::int AS total,
                COALESCE(SUM((r.data->>$${countParams.length})::numeric), 0)::float AS sum
           FROM collection_records r WHERE ${filterWhere.join(' AND ')}`,
        countParams,
      );
      total = row.total;
      aggregate = { kind: q.aggregate, value: row.sum };
    } else {
      const [row] = await manager.query(
        `SELECT count(*)::int AS total FROM collection_records r WHERE ${filterWhere.join(' AND ')}`,
        countParams,
      );
      total = row.total;
      if (q.aggregate === 'count') aggregate = { kind: 'count', value: total };
    }

    const records = await this.views(
      manager,
      chatbotId,
      list,
      actor,
      page.map((r) => this.entity(r)),
    );
    return { records, total, next_cursor, ...(aggregate ? { aggregate } : {}) };
  }

  // ---- the parts of a write -------------------------------------------------------------------

  private async run<T extends object>(
    opts: ListWriteOptions,
    work: (m: EntityManager) => Promise<T>,
  ): Promise<T & { dry_run?: true }> {
    if (opts.manager) {
      const out = await work(opts.manager);
      return opts.dryRun ? { ...out, dry_run: true as const } : out;
    }
    if (!opts.dryRun) return this.dataSource.transaction(work);
    let out: T | undefined;
    try {
      await this.dataSource.transaction(async (m) => {
        out = await work(m);
        throw ROLLBACK;
      });
    } catch (err) {
      if (err !== ROLLBACK) throw err;
    }
    return { ...(out as T), dry_run: true as const };
  }

  private async list(
    m: EntityManager,
    chatbotId: string,
    key: string,
    lock?: 'share',
  ): Promise<LoadedList> {
    const list = await loadList(m, chatbotId, key, lock);
    if (!list) throw refuse.notFound();
    return list;
  }

  /**
   * The person a call is scoped to, on a list with a person field: a contact id, `null` (no one,
   * so nothing), or `undefined` (not scoped). The agent is always scoped there.
   */
  private scope(
    list: LoadedList,
    actor: ListActor,
    opts: ListScope,
  ): string | null | undefined {
    if (!list.personField) return undefined;
    if (opts.contactId !== undefined) return opts.contactId;
    return isAgent(actor) ? null : undefined;
  }

  private agentReads(list: LoadedList, field: CollectionField): boolean {
    return (
      list.collection.agentRead &&
      field.agentRead &&
      !field.privacy?.never_store
    );
  }

  private agentWrites(list: LoadedList, field: CollectionField): boolean {
    return (
      list.collection.agentWrite &&
      field.agentWrite &&
      !field.privacy?.never_store &&
      field.key !== list.personField?.key
    );
  }

  private assertAgentReads(list: LoadedList, actor: ListActor): void {
    if (isAgent(actor) && !list.collection.agentRead) throw refuse.notFound();
  }

  private assertAgentWrites(list: LoadedList, actor: ListActor): void {
    if (isAgent(actor) && !list.collection.agentWrite) {
      throw refuse.notWritable(undefined, list.collection.name);
    }
  }

  /** The input's values, checked for this actor and normalised. Unknown keys are refused. */
  private checkInput(
    list: LoadedList,
    actor: ListActor,
    input: Data,
    scope: string | null | undefined,
  ): Data {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw refuse.invalidValue(
        undefined,
        'The entry',
        'it should be an object of fields',
      );
    }
    const out: Data = {};
    for (const [key, raw] of Object.entries(input)) {
      const field = list.field(key);
      if (!field) {
        throw refuse.invalidValue(key, key, "it isn't a field of this list");
      }
      const person = field.key === list.personField?.key;
      if (isAgent(actor) && !this.agentWrites(list, field)) {
        throw refuse.notWritable(field.key, field.label);
      }
      const value = normaliseValue(field, raw);
      if (person && scope !== undefined && value !== scope) {
        throw refuse.notWritable(field.key, field.label);
      }
      out[key] = value;
    }
    return out;
  }

  private checkRequired(list: LoadedList, data: Data): void {
    for (const field of list.fields) {
      if (
        field.required &&
        (data[field.key] === undefined || data[field.key] === null)
      ) {
        throw refuse.requiredMissing(field.key, field.label);
      }
    }
  }

  private checkSize(data: Data): void {
    if (
      Buffer.byteLength(JSON.stringify(data)) > LIST_LIMITS.dataBytesPerRecord
    ) {
      throw refuse.limitExceeded(LIMIT_WORDS.dataBytesPerRecord);
    }
  }

  /** Every relation value points at a live record of the named list, or a contact, of this bot. */
  private async checkRelations(
    m: EntityManager,
    chatbotId: string,
    list: LoadedList,
    data: Data,
  ): Promise<void> {
    for (const field of list.fields) {
      const value = data[field.key];
      if (field.type !== ListFieldType.RELATION || typeof value !== 'string')
        continue;
      const to = relationTarget(field);
      const found: unknown[] =
        to === 'contact'
          ? await m.query(
              `SELECT 1 FROM chatbot_contacts WHERE id = $1 AND chatbot_id = $2`,
              [value, chatbotId],
            )
          : await m.query(
              `SELECT 1 FROM collection_records r
                 JOIN collections c ON c.id = r.collection_id
                WHERE r.id = $1 AND r.chatbot_id = $2 AND r.deleted_at IS NULL
                  AND c.chatbot_id = $2 AND c.key = $3 AND c.deleted_at IS NULL`,
              [value, chatbotId, to],
            );
      if (!found.length) {
        throw refuse.invalidValue(
          field.key,
          field.label,
          "that entry doesn't exist",
        );
      }
    }
  }

  /** Counted, not serialised per bot: two writes at once can go one over. */
  private async checkRecordLimit(
    m: EntityManager,
    chatbotId: string,
  ): Promise<void> {
    const [row] = await m.query(
      `SELECT count(*)::int AS n FROM collection_records WHERE chatbot_id = $1 AND deleted_at IS NULL`,
      [chatbotId],
    );
    if (row.n >= LIST_LIMITS.recordsPerBot) {
      throw refuse.limitExceeded(LIMIT_WORDS.recordsPerBot);
    }
  }

  private async lockRow(
    m: EntityManager,
    chatbotId: string,
    list: LoadedList,
    recordId: string,
    scope: string | null | undefined,
    deleted: boolean,
  ): Promise<RecordRow> {
    if (scope === null || !/^[0-9a-f-]{36}$/i.test(recordId))
      throw refuse.notFound();
    const [row]: RecordRow[] = await m.query(
      `SELECT * FROM collection_records
        WHERE id = $1 AND collection_id = $2 AND chatbot_id = $3
          AND deleted_at IS ${deleted ? 'NOT NULL' : 'NULL'}
        FOR UPDATE`,
      [recordId, list.collection.id, chatbotId],
    );
    if (!row || (scope !== undefined && row.contact_id !== scope)) {
      throw refuse.notFound();
    }
    return row;
  }

  /**
   * Takes the rules' locks, then checks each rule against the record as it will be. `before` is
   * the stored record on an update (`null` on a create or restore).
   */
  private async enforceRules(
    m: EntityManager,
    chatbotId: string,
    list: LoadedList,
    actor: ListActor,
    opts: ListWriteOptions,
    data: Data,
    before: RecordRow | null,
    { transitions = true } = {},
  ): Promise<void> {
    const recordId = before?.id ?? NO_RECORD;
    const guarded = list.rules.filter(
      (r) => r.kind !== ListConstraintKind.TRANSITIONS,
    );
    const locks: ListLock[] = [];
    for (const rule of guarded) {
      if (opts.lockMode === 'list') {
        locks.push({ key: ruleLock(rule.id), shared: false });
        continue;
      }
      const value = this.guardedValue(rule, data);
      if (value === undefined) continue;
      locks.push({ key: ruleLock(rule.id), shared: true });
      locks.push({ key: valueLock(rule.id, value), shared: false });
    }
    await takeLocks(m, locks);

    for (const rule of list.rules) {
      switch (rule.kind) {
        case ListConstraintKind.UNIQUE:
          await this.checkUnique(
            m,
            chatbotId,
            list,
            actor,
            rule,
            data,
            recordId,
          );
          break;
        case ListConstraintKind.CAPACITY:
          await this.checkCapacity(
            m,
            chatbotId,
            list,
            actor,
            rule,
            data,
            recordId,
          );
          break;
        case ListConstraintKind.LIMIT_PER_PERSON:
          await this.checkLimitPerPerson(m, list, rule, data, recordId);
          break;
        case ListConstraintKind.TRANSITIONS:
          if (transitions) this.checkTransition(list, rule, data, before);
          break;
      }
    }
  }

  /** The value a rule guards in this record, or `undefined` when the rule doesn't apply to it. */
  private guardedValue(rule: CollectionConstraint, data: Data): unknown {
    const config = rule.config as { where?: UniqueConfig['where'] };
    if (!matchesWhere(config.where, data)) return undefined;
    if (rule.kind === ListConstraintKind.UNIQUE) {
      const values = (rule.config as unknown as UniqueConfig).fields.map(
        (f) => data[f],
      );
      return values.some((v) => v === undefined || v === null)
        ? undefined
        : values;
    }
    const value = data[(rule.config as { field: string }).field];
    return value === undefined || value === null ? undefined : value;
  }

  /** Live records other than this one with these values, under the rule's `where`. */
  private async countOthers(
    m: EntityManager,
    collectionId: string,
    values: Data,
    where: UniqueConfig['where'],
    recordId: string,
  ): Promise<number> {
    const sql = new Sql();
    const [row] = await m.query(
      `SELECT count(*)::int AS n FROM collection_records
        WHERE collection_id = ${sql.p(collectionId)} AND deleted_at IS NULL
          AND id <> ${sql.p(recordId)}::uuid
          AND data @> ${sql.p(JSON.stringify(values))}::jsonb
          AND ${whereSql(sql, where)}`,
      sql.params,
    );
    return row.n;
  }

  private async checkUnique(
    m: EntityManager,
    chatbotId: string,
    list: LoadedList,
    actor: ListActor,
    rule: CollectionConstraint,
    data: Data,
    recordId: string,
  ): Promise<void> {
    const config = rule.config as unknown as UniqueConfig;
    const values = this.guardedValue(rule, data) as unknown[] | undefined;
    if (!values) return;
    const match = Object.fromEntries(
      config.fields.map((f, i) => [f, values[i]]),
    );
    if (
      !(await this.countOthers(
        m,
        list.collection.id,
        match,
        config.where,
        recordId,
      ))
    ) {
      return;
    }
    const field = list.field(config.fields[0])!;
    const alternatives =
      config.fields.length === 1
        ? await this.alternatives(
            m,
            chatbotId,
            list,
            actor,
            field,
            async (id) =>
              !(await this.countOthers(
                m,
                list.collection.id,
                { [field.key]: id },
                config.where,
                recordId,
              )),
          )
        : undefined;
    throw new ListRefusalException({
      code: 'unique_taken',
      field: field.key,
      message: LIST_COPY.unique_taken(field.label),
      ...(alternatives ? { conflict: { alternatives } } : {}),
    });
  }

  private async capacityOf(
    m: EntityManager,
    chatbotId: string,
    config: CapacityConfig,
    target: unknown,
  ): Promise<number> {
    if (config.max !== undefined) return config.max;
    const [row] = await m.query(
      `SELECT data->>$2 AS max FROM collection_records
        WHERE id = $1 AND chatbot_id = $3 AND deleted_at IS NULL`,
      [target, config.max_from, chatbotId],
    );
    const max = Number(row?.max);
    return Number.isFinite(max) ? max : 0;
  }

  private async checkCapacity(
    m: EntityManager,
    chatbotId: string,
    list: LoadedList,
    actor: ListActor,
    rule: CollectionConstraint,
    data: Data,
    recordId: string,
  ): Promise<void> {
    const config = rule.config as unknown as CapacityConfig;
    const value = this.guardedValue(rule, data);
    if (value === undefined) return;
    const taken = await this.countOthers(
      m,
      list.collection.id,
      { [config.field]: value },
      config.where,
      recordId,
    );
    if (taken < (await this.capacityOf(m, chatbotId, config, value))) return;

    const field = list.field(config.field)!;
    const titles = new TitleResolver(m, chatbotId, isAgent(actor));
    await titles.preload(list, [{ data }]);
    const target = await titles.display(field, value);
    const alternatives = await this.alternatives(
      m,
      chatbotId,
      list,
      actor,
      field,
      async (id) => {
        const others = await this.countOthers(
          m,
          list.collection.id,
          { [config.field]: id },
          config.where,
          recordId,
        );
        return others < (await this.capacityOf(m, chatbotId, config, id));
      },
    );
    throw new ListRefusalException({
      code: 'capacity_full',
      field: field.key,
      message: LIST_COPY.capacity_full(target),
      ...(alternatives ? { conflict: { alternatives } } : {}),
    });
  }

  private async checkLimitPerPerson(
    m: EntityManager,
    list: LoadedList,
    rule: CollectionConstraint,
    data: Data,
    recordId: string,
  ): Promise<void> {
    const config = rule.config as unknown as LimitPerPersonConfig;
    const value = this.guardedValue(rule, data);
    if (value === undefined) return;
    const others = await this.countOthers(
      m,
      list.collection.id,
      { [config.field]: value },
      config.where,
      recordId,
    );
    if (others < config.max) return;
    throw new ListRefusalException({
      code: 'limit_reached',
      field: config.field,
      message: LIST_COPY.limit_reached(config.max, list.collection.name),
    });
  }

  /** A create starts in an `initial` value; an update moves only along `allowed`. */
  private checkTransition(
    list: LoadedList,
    rule: CollectionConstraint,
    data: Data,
    before: RecordRow | null,
  ): void {
    const config = rule.config as unknown as TransitionsConfig;
    const to = data[config.field] as string | undefined;
    const field = list.field(config.field);
    if (!before) {
      if (to !== undefined && config.initial.includes(to)) return;
      throw new ListRefusalException({
        code: 'transition_not_allowed',
        field: config.field,
        message: LIST_COPY.transition_not_allowed(
          list.collection.name,
          'new',
          to ?? `no ${field?.label.toLowerCase() ?? config.field}`,
        ),
      });
    }
    const from = before.data[config.field] as string | undefined;
    if (from === to) return;
    if (
      from !== undefined &&
      to !== undefined &&
      config.allowed[from]?.includes(to)
    )
      return;
    throw new ListRefusalException({
      code: 'transition_not_allowed',
      field: config.field,
      message: LIST_COPY.transition_not_allowed(
        list.collection.name,
        from ?? 'nothing',
        to ?? 'nothing',
      ),
    });
  }

  /**
   * Up to 3 records of the list a relation points at that would pass the rule: from now onwards
   * (by the target list's first date or date-and-time field), in its default sort. Only fields
   * the actor may read are included. The agent gets none from a list it can't read or a list that
   * belongs to people.
   */
  private async alternatives(
    m: EntityManager,
    chatbotId: string,
    list: LoadedList,
    actor: ListActor,
    field: CollectionField,
    passes: (targetId: string) => Promise<boolean>,
  ): Promise<ListRecordView[] | undefined> {
    const to = relationTarget(field);
    if (field.type !== ListFieldType.RELATION || to === 'contact')
      return undefined;
    const target = await loadList(m, chatbotId, to);
    if (!target) return undefined;
    if (
      isAgent(actor) &&
      (!target.collection.agentRead || target.personField)
    ) {
      return [];
    }
    const dateField = target.fields.find(
      (f) => f.type === ListFieldType.DATE || f.type === ListFieldType.DATETIME,
    );
    const sql = new Sql();
    const where = [
      `collection_id = ${sql.p(target.collection.id)}`,
      `chatbot_id = ${sql.p(chatbotId)}`,
      'deleted_at IS NULL',
    ];
    if (dateField) {
      where.push(
        dateField.type === ListFieldType.DATE
          ? `${sql.text(dateField.key)}::date >= current_date`
          : `${sql.text(dateField.key)}::timestamptz >= now()`,
      );
    }
    const spec =
      target.collection.settings?.default_sort ??
      (dateField ? dateField.key : '');
    const sortField = target.field(spec.replace(/^-/, ''));
    const order = sortField
      ? `${sql.text(sortField.key)}${cast(sortField)} ${spec.startsWith('-') ? 'DESC' : 'ASC'} NULLS LAST, id`
      : '"createdAt", id';

    const found: RecordRow[] = [];
    const pageSize = 30;
    for (let page = 0; page < 4 && found.length < MAX_ALTERNATIVES; page++) {
      const rows: RecordRow[] = await m.query(
        `SELECT * FROM collection_records WHERE ${where.join(' AND ')}
          ORDER BY ${order} LIMIT ${pageSize} OFFSET ${page * pageSize}`,
        sql.params,
      );
      for (const row of rows) {
        if (found.length >= MAX_ALTERNATIVES) break;
        if (await passes(row.id)) found.push(row);
      }
      if (rows.length < pageSize) break;
    }
    return this.views(
      m,
      chatbotId,
      target,
      actor,
      found.map((r) => this.entity(r)),
    );
  }

  private personOf(list: LoadedList, data: Data): string | null {
    const key = list.personField?.key;
    const value = key ? data[key] : null;
    return typeof value === 'string' ? value : null;
  }

  private async writeLinks(
    m: EntityManager,
    list: LoadedList,
    recordId: string,
    data: Data,
  ): Promise<void> {
    await m.delete(RecordLink, { recordId });
    const links = list.fields
      .filter(
        (f) =>
          f.type === ListFieldType.RELATION && typeof data[f.key] === 'string',
      )
      .map((f) => ({
        recordId,
        fieldKey: f.key,
        targetKind:
          relationTarget(f) === 'contact'
            ? RecordLinkTargetKind.CONTACT
            : RecordLinkTargetKind.RECORD,
        targetId: data[f.key] as string,
      }));
    if (links.length) await m.insert(RecordLink, links);
  }

  private async event(
    m: EntityManager,
    recordId: string,
    op: RecordEventOp,
    before: Data | null,
    after: Data | null,
    actor: ListActor,
  ): Promise<void> {
    await m.insert(RecordEvent, {
      recordId,
      op,
      before: before as QueryDeepPartialEntity<Data> | null,
      after: after as QueryDeepPartialEntity<Data> | null,
      actor: actorRef(actor),
      runId: isAgent(actor) ? actor.runId : null,
    });
  }

  // ---- views ----------------------------------------------------------------------------------

  private entity(row: RecordRow): CollectionRecord {
    return {
      id: row.id,
      chatbotId: '',
      collectionId: row.collection_id,
      data: row.data,
      contactId: row.contact_id,
      createdBy: { kind: 'import', user_id: null },
      version: row.version,
      deletedAt: row.deleted_at,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private async view(
    m: EntityManager,
    chatbotId: string,
    list: LoadedList,
    actor: ListActor,
    record: CollectionRecord,
  ): Promise<ListRecordView> {
    const [view] = await this.views(m, chatbotId, list, actor, [record]);
    return view;
  }

  /** Records as the actor may see them, with titles and display values. */
  async views(
    m: EntityManager,
    chatbotId: string,
    list: LoadedList,
    actor: ListActor,
    records: CollectionRecord[],
  ): Promise<ListRecordView[]> {
    const agent = isAgent(actor);
    const titles = new TitleResolver(m, chatbotId, agent);
    const visible = list.fields.filter((f) => titles.canSee(list, f));
    await titles.preload(
      list,
      records.map((r) => ({
        data: Object.fromEntries(visible.map((f) => [f.key, r.data?.[f.key]])),
      })),
    );
    const out: ListRecordView[] = [];
    for (const record of records) {
      const data: Data = {};
      const display: Record<string, string> = {};
      for (const field of visible) {
        const value = record.data?.[field.key];
        if (value === undefined || value === null) continue;
        if (agent && field.privacy?.masked) {
          data[field.key] = maskValue(value);
          display[field.key] = maskValue(value)!;
        } else {
          data[field.key] = value;
          display[field.key] = await titles.display(field, value);
        }
      }
      out.push({
        id: record.id,
        version: record.version,
        title: await titles.title(list, record.data ?? {}),
        data,
        display,
        contact_id: record.contactId ?? null,
        created_at: iso(record.createdAt)!,
        updated_at: iso(record.updatedAt)!,
        ...(record.deletedAt !== undefined
          ? { deleted_at: iso(record.deletedAt) }
          : {}),
      });
    }
    return out;
  }
}
