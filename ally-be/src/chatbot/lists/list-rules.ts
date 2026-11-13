import type { EntityManager } from 'typeorm';
import type { CollectionConstraint } from '../entity/collection-constraint.entity';
import type { CollectionField } from '../entity/collection-field.entity';
import { ListConstraintKind, ListFieldType } from '../enum/list.enum';
import {
  isContactRelation,
  NUMERIC_TYPES,
  relationTarget,
  selectValues,
} from './list-fields';
import { refuse } from './list-refusals';
import type { LoadedList } from './list-store';
import type {
  CapacityConfig,
  LimitPerPersonConfig,
  TransitionsConfig,
  UniqueConfig,
  WhereClause,
} from './list-types';

/** Builds a parameterised query: every value, field keys included, is a bind parameter. */
export class Sql {
  readonly params: unknown[] = [];
  p(value: unknown): string {
    this.params.push(value);
    return `$${this.params.length}`;
  }
  /** A field's text value: `data->>$n`. */
  text(key: string, alias = ''): string {
    return `(${alias}data->>${this.p(key)})`;
  }
}

const cellText = (value: unknown): string =>
  value === null || value === undefined ? '' : String(value);

/** The SQL for a `where` (in / not_in over the value as text; empty counts as ''). */
export function whereSql(
  sql: Sql,
  where: WhereClause | undefined,
  alias = '',
): string {
  if (!where) return 'TRUE';
  const value = `COALESCE(${sql.text(where.field, alias)}, '')`;
  return where.in
    ? `${value} = ANY(${sql.p(where.in)}::text[])`
    : `NOT (${value} = ANY(${sql.p(where.not_in ?? [])}::text[]))`;
}

/** Whether a record's data falls under a `where`, as `whereSql` would decide. */
export function matchesWhere(
  where: WhereClause | undefined,
  data: Record<string, unknown>,
): boolean {
  if (!where) return true;
  const value = cellText(data[where.field]);
  return where.in
    ? where.in.includes(value)
    : !(where.not_in ?? []).includes(value);
}

/** The field a rule guards (`unique` guards several; its first names it). */
export function ruleFields(rule: CollectionConstraint): string[] {
  const config = rule.config as Record<string, unknown>;
  const fields =
    rule.kind === ListConstraintKind.UNIQUE
      ? [...((config.fields as string[]) ?? [])]
      : [String(config.field)];
  const where = config.where as WhereClause | undefined;
  if (where?.field) fields.push(where.field);
  return fields;
}

const intIn = (n: unknown, min: number, max: number): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max;

function checkWhere(list: LoadedList, where: unknown): WhereClause | undefined {
  if (where === undefined || where === null) return undefined;
  const w = where as Record<string, unknown>;
  const field = list.field(typeof w.field === 'string' ? w.field : undefined);
  const values = w.in ?? w.not_in;
  if (
    !field ||
    (w.in !== undefined) === (w.not_in !== undefined) ||
    !Array.isArray(values) ||
    values.length > 50 ||
    values.some((v) => typeof v !== 'string')
  ) {
    throw refuse.invalidValue(
      undefined,
      'The rule',
      "its condition needs a field of this list and a list of values for 'in' or 'not_in'",
    );
  }
  return w.in !== undefined
    ? { field: field.key, in: values as string[] }
    : { field: field.key, not_in: values as string[] };
}

/**
 * A rule's config, checked against the list's fields and normalised. `targetList` loads another
 * list of the same bot, for `max_from`.
 */
export async function normaliseRuleConfig(
  list: LoadedList,
  kind: ListConstraintKind,
  raw: Record<string, unknown>,
  targetList: (key: string) => Promise<LoadedList | null>,
): Promise<Record<string, unknown>> {
  const bad = (why: string) => refuse.invalidValue(undefined, 'The rule', why);
  const fieldOf = (key: unknown): CollectionField => {
    const field = list.field(typeof key === 'string' ? key : undefined);
    if (!field) throw bad(`${String(key)} isn't a field of this list`);
    return field;
  };
  switch (kind) {
    case ListConstraintKind.UNIQUE: {
      const fields = raw.fields;
      if (!Array.isArray(fields) || !fields.length || fields.length > 5) {
        throw bad('it needs 1 to 5 fields');
      }
      const keys = [...new Set(fields.map((f) => fieldOf(f).key))];
      const config: UniqueConfig = { fields: keys };
      const where = checkWhere(list, raw.where);
      if (where) config.where = where;
      return { ...config };
    }
    case ListConstraintKind.CAPACITY: {
      const field = fieldOf(raw.field);
      const config: CapacityConfig = { field: field.key };
      if ((raw.max === undefined) === (raw.max_from === undefined)) {
        throw bad("it needs either 'max' or 'max_from'");
      }
      if (raw.max !== undefined) {
        if (!intIn(raw.max, 1, 1_000_000))
          throw bad('max is a whole number from 1');
        config.max = raw.max;
      } else {
        const to = relationTarget(field);
        const target =
          field.type === ListFieldType.RELATION && to !== 'contact'
            ? await targetList(to)
            : null;
        const from = target?.field(
          typeof raw.max_from === 'string' ? raw.max_from : undefined,
        );
        if (!from || from.type !== ListFieldType.NUMBER) {
          throw bad(
            'max_from names a number field on the list the relation points at',
          );
        }
        config.max_from = from.key;
      }
      const where = checkWhere(list, raw.where);
      if (where) config.where = where;
      return { ...config };
    }
    case ListConstraintKind.LIMIT_PER_PERSON: {
      const field = fieldOf(raw.field);
      if (!isContactRelation(field)) {
        throw bad('the field must be a relation to a contact');
      }
      if (!intIn(raw.max, 1, 10_000)) throw bad('max is a whole number from 1');
      const config: LimitPerPersonConfig = { field: field.key, max: raw.max };
      const where = checkWhere(list, raw.where);
      if (where) config.where = where;
      return { ...config };
    }
    case ListConstraintKind.TRANSITIONS: {
      const field = fieldOf(raw.field);
      if (field.type !== ListFieldType.SELECT) {
        throw bad('transitions work on a select field');
      }
      const values = selectValues(field);
      const known = (v: unknown) => typeof v === 'string' && values.includes(v);
      const initial = raw.initial;
      if (!Array.isArray(initial) || !initial.length || !initial.every(known)) {
        throw bad(`initial lists values of ${field.key}`);
      }
      const allowed = raw.allowed;
      if (!allowed || typeof allowed !== 'object' || Array.isArray(allowed)) {
        throw bad('allowed maps each value to the values it can move to');
      }
      const moves: Record<string, string[]> = {};
      for (const [from, to] of Object.entries(allowed)) {
        if (!known(from) || !Array.isArray(to) || !to.every(known)) {
          throw bad(`allowed uses only values of ${field.key}`);
        }
        moves[from] = [...new Set(to as string[])];
      }
      const config: TransitionsConfig = {
        field: field.key,
        initial: [...new Set(initial as string[])],
        allowed: moves,
      };
      return { ...config };
    }
  }
}

/**
 * The live records that already break a rule, so it isn't added while they do. Capacity reads
 * each target's `max_from` value from its record.
 */
export async function findViolations(
  manager: EntityManager,
  list: LoadedList,
  kind: ListConstraintKind,
  config: Record<string, unknown>,
): Promise<string[]> {
  const sql = new Sql();
  const base = `collection_id = ${sql.p(list.collection.id)} AND deleted_at IS NULL`;
  switch (kind) {
    case ListConstraintKind.UNIQUE: {
      const c = config as unknown as UniqueConfig;
      const cols = c.fields.map((f) => sql.text(f));
      const rows: { ids: string[] }[] = await manager.query(
        `SELECT array_agg(id ORDER BY "createdAt") AS ids FROM collection_records
          WHERE ${base} AND ${whereSql(sql, c.where)}
            AND ${cols.map((col) => `${col} IS NOT NULL`).join(' AND ')}
          GROUP BY ${cols.join(', ')} HAVING count(*) > 1`,
        sql.params,
      );
      return rows.flatMap((r) => r.ids);
    }
    case ListConstraintKind.CAPACITY:
    case ListConstraintKind.LIMIT_PER_PERSON: {
      const c = config as unknown as CapacityConfig;
      const col = sql.text(c.field);
      const rows: { value: string; ids: string[] }[] = await manager.query(
        `SELECT ${col} AS value, array_agg(id ORDER BY "createdAt") AS ids
           FROM collection_records
          WHERE ${base} AND ${whereSql(sql, c.where)} AND ${col} IS NOT NULL
          GROUP BY ${col}`,
        sql.params,
      );
      const out: string[] = [];
      for (const row of rows) {
        let max = c.max;
        if (max === undefined && c.max_from) {
          const [target] = await manager.query(
            `SELECT data->>$2 AS max FROM collection_records
              WHERE id = $1 AND chatbot_id = $3`,
            [row.value, c.max_from, list.collection.chatbotId],
          );
          max = Number(target?.max ?? 0) || 0;
        }
        if (row.ids.length > (max ?? 0)) out.push(...row.ids);
      }
      return out;
    }
    case ListConstraintKind.TRANSITIONS: {
      const c = config as unknown as TransitionsConfig;
      const states = new Set([
        ...c.initial,
        ...Object.keys(c.allowed),
        ...Object.values(c.allowed).flat(),
      ]);
      const rows: { id: string }[] = await manager.query(
        `SELECT id FROM collection_records
          WHERE ${base} AND NOT (COALESCE(${sql.text(c.field)}, '') = ANY(${sql.p([...states])}::text[]))
          ORDER BY "createdAt"`,
        sql.params,
      );
      return rows.map((r) => r.id);
    }
  }
}

/** Whether a numeric aggregate (`sum:<key>`) can run over this field. */
export const summable = (field: CollectionField | undefined): boolean =>
  !!field && NUMERIC_TYPES.has(field.type);
