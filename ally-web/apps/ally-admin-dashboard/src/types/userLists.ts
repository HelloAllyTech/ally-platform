/**
 * An assistant's lists (Agents v2, chunks 5a and 5b), as ally-be's owner API serves them under
 * `v1/chatbots/:id/lists`. Snake case, as the API sends it.
 */

export type ListFieldType =
  | "text"
  | "long_text"
  | "number"
  | "money"
  | "date"
  | "datetime"
  | "duration"
  | "select"
  | "boolean"
  | "phone"
  | "email"
  | "url"
  | "relation";

export type ListRuleKind = "unique" | "capacity" | "limit_per_person" | "transitions";

export type ListAbility = "do_it" | "never";

export interface ListFieldPrivacy {
  masked?: boolean;
  never_store?: boolean;
}

export interface ListField {
  key: string;
  label: string;
  type: ListFieldType;
  /** `values` for a select; `to` for a relation (a list key, or `contact`). */
  options: { values?: string[]; to?: string; [key: string]: unknown };
  required: boolean;
  default: unknown;
  privacy: ListFieldPrivacy;
  agent_read: boolean;
  agent_write: boolean;
  position: number;
  archived_at: string | null;
}

export interface ListWhere {
  field: string;
  in?: string[];
  not_in?: string[];
}

export interface UniqueRule {
  fields: string[];
  where?: ListWhere;
}
export interface CapacityRule {
  field: string;
  max?: number;
  max_from?: string;
  where?: ListWhere;
}
export interface LimitPerPersonRule {
  field: string;
  max: number;
  where?: ListWhere;
}
export interface TransitionsRule {
  field: string;
  initial: string[];
  allowed: Record<string, string[]>;
}

export type ListRule =
  | { id: string; kind: "unique"; config: UniqueRule }
  | { id: string; kind: "capacity"; config: CapacityRule }
  | { id: string; kind: "limit_per_person"; config: LimitPerPersonRule }
  | { id: string; kind: "transitions"; config: TransitionsRule };

export interface ListSettings {
  title_field?: string;
  default_sort?: string;
  person_field?: string;
}

export interface UserList {
  id: string;
  key: string;
  name: string;
  settings: ListSettings;
  agent_read: boolean;
  agent_write: boolean;
  deleted_at: string | null;
  record_count: number;
  fields: ListField[];
  rules: ListRule[];
  /** What the assistant may do with it (chunk 5b): find, create and update. */
  abilities: { find: ListAbility; create: ListAbility; update: ListAbility };
  /** The business's time zone, for showing dates and times. */
  time_zone: string;
}

export interface ListEntryCreator {
  kind: "user" | "agent" | "import";
  name?: string;
  /** The reader made it. */
  you?: boolean;
  conversation_id?: string;
}

export interface ListEntry {
  id: string;
  version: number;
  title: string;
  data: Record<string, unknown>;
  display: Record<string, string>;
  contact_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
  created_by?: ListEntryCreator | null;
}

export interface ListEntriesPage {
  records: ListEntry[];
  total: number;
  next_cursor: string | null;
}

export type ListFilterOp = "eq" | "contains" | "from" | "to";

export interface ListFilter {
  field: string;
  op: ListFilterOp;
  value: unknown;
}

export interface ListEntriesQuery {
  filters?: ListFilter[];
  /** Contains, over every text detail at once (chunk 5b). */
  search?: string;
  sort?: string;
  cursor?: string;
  limit?: number;
}

export type ListRefusalCode =
  | "required_missing"
  | "invalid_value"
  | "not_writable"
  | "unique_taken"
  | "capacity_full"
  | "limit_reached"
  | "transition_not_allowed"
  | "not_found"
  | "version_conflict"
  | "limit_exceeded"
  | "in_use";

/** A refusal from the lists engine: ally-be sends it as the error's `details`. */
export interface ListRefusal {
  code: ListRefusalCode;
  field?: string;
  message: string;
  conflict?: {
    alternatives?: { id: string; title: string }[];
    records?: { id: string; title: string }[];
  };
}

export interface ReadyMadeField {
  key: string;
  label: string;
  type: ListFieldType;
  required: boolean;
}

export interface ReadyMadeItem {
  /** The catalogue's slug: `appointments`, `site_visits`… */
  name: string;
  title: string;
  one_liner: string;
  examples: string[];
  lists: { key: string; name: string; fields: ReadyMadeField[] }[];
  /** Selects that install with example values for the owner to replace ("your services"). */
  needs_options: { list: string; field: string; label: string; examples: string[] }[];
}

export interface ReadyMadeCatalogue {
  groups: { name: string; items: ReadyMadeItem[] }[];
}

export interface RepeatWeeklyRequest {
  field: string;
  /** 1 = Monday … 7 = Sunday. */
  days: number[];
  start: string;
  end: string;
  every_minutes: number;
  from?: string;
  until: string;
  values?: Record<string, unknown>;
  dry_run?: boolean;
}

export interface RepeatWeeklyResult {
  count: number;
  skipped: number;
  first: string[];
  dry_run: boolean;
}
