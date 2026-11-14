import type { EntityManager } from 'typeorm';
import type { RecordActorRef } from '../entity/collection-record.entity';

/**
 * Who is reading or writing a list (chunk 5a). A user is an owner or editor on the dashboard; an
 * import is a CSV file; the agent is a run, which sees only what each list and field allows.
 */
export type ListActor =
  | { kind: 'user'; userId: number }
  | { kind: 'import'; userId: number | null }
  | { kind: 'agent'; runId: string };

export const isAgent = (
  actor: ListActor,
): actor is { kind: 'agent'; runId: string } => actor.kind === 'agent';

export function actorRef(actor: ListActor): RecordActorRef {
  if (actor.kind === 'agent') return { kind: 'agent', run_id: actor.runId };
  if (actor.kind === 'import') return { kind: 'import', user_id: actor.userId };
  return { kind: 'user', user_id: actor.userId };
}

export interface ListScope {
  /**
   * Scopes a read or write to one person, on a list with a person field: a read sees only their
   * records, and a write sets the person field to them and can't change it. `null` means a person
   * who isn't known (Preview): reads see nothing and writes are refused. Left out, nothing is
   * scoped, except for the agent, which is always scoped (left out counts as `null`).
   */
  contactId?: string | null;
}

export interface ListWriteOptions extends ListScope {
  /** Check every rule and return the real result, then roll back: nothing is saved. */
  dryRun?: boolean;
  /**
   * Run inside the caller's transaction instead of a new one (CSV import, with a savepoint per
   * row). The caller commits or rolls back.
   */
  manager?: EntityManager;
  /**
   * `list`: take each rule's list-wide lock instead of one per value. An import holds these for
   * its whole transaction, so it never needs thousands of value locks.
   */
  lockMode?: 'value' | 'list';
}

/** A structured condition on one field, never a string to parse. Exactly one of `in`/`not_in`. */
export interface WhereClause {
  field: string;
  in?: string[];
  not_in?: string[];
}

export interface UniqueConfig {
  fields: string[];
  where?: WhereClause;
}

/** `max`, or `max_from`: a number field on the record the relation points at. */
export interface CapacityConfig {
  field: string;
  max?: number;
  max_from?: string;
  where?: WhereClause;
}

/** `field` is the relation-to-contact field that names the person. */
export interface LimitPerPersonConfig {
  field: string;
  max: number;
  where?: WhereClause;
}

export interface TransitionsConfig {
  field: string;
  initial: string[];
  allowed: Record<string, string[]>;
}

export type ListFilterOp = 'eq' | 'contains' | 'from' | 'to';

export interface ListFilter {
  field: string;
  op: ListFilterOp;
  value: unknown;
}

export interface ListQuery {
  filters?: ListFilter[];
  /** A field key, `-key` for descending. The list's default sort otherwise. */
  sort?: string;
  cursor?: string;
  /** 1–100, 25 by default. */
  limit?: number;
  /** `count`, or `sum:<key>` over a number, money or duration field. */
  aggregate?: string;
  /** Users only: include deleted records (to restore them). */
  includeDeleted?: boolean;
  /**
   * Users only (chunk 5b): entries where any text, long text, phone, email or URL field contains
   * this, ignoring case; ANDed with the filters.
   */
  search?: string;
}

/** A record as an actor may see it. */
export interface ListRecordView {
  id: string;
  version: number;
  title: string;
  /** Values by field key: only the fields the actor may read, masked where set. */
  data: Record<string, unknown>;
  /** The same fields rendered for display: a relation shows its target's title. */
  display: Record<string, string>;
  contact_id: string | null;
  created_at: string;
  updated_at: string;
  /** People's reads only (chunk 5b): who made it. Left out for the agent. */
  created_by?: RecordCreator | null;
  deleted_at?: string | null;
}

/** "Created by" on an entry's form: You, a teammate, your assistant (and its chat), or an import. */
export interface RecordCreator {
  kind: 'user' | 'agent' | 'import';
  name?: string;
  /** The reader made it. */
  you?: true;
  conversation_id?: string;
}

export interface ListQueryResult {
  records: ListRecordView[];
  total: number;
  next_cursor: string | null;
  aggregate?: { kind: string; value: number };
}

export interface ListWriteResult {
  record: ListRecordView;
  dry_run?: true;
}
