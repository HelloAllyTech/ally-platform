/** A list field's type (Agents v2, chunk 5a). Stored as varchar with a CHECK. */
export enum ListFieldType {
  TEXT = 'text',
  LONG_TEXT = 'long_text',
  NUMBER = 'number',
  MONEY = 'money',
  DATE = 'date',
  DATETIME = 'datetime',
  DURATION = 'duration',
  SELECT = 'select',
  BOOLEAN = 'boolean',
  PHONE = 'phone',
  EMAIL = 'email',
  URL = 'url',
  RELATION = 'relation',
}

/** A rule on a list, enforced in code inside the write's transaction (chunk 5a). */
export enum ListConstraintKind {
  UNIQUE = 'unique',
  CAPACITY = 'capacity',
  LIMIT_PER_PERSON = 'limit_per_person',
  TRANSITIONS = 'transitions',
}

/** What a relation field points at: another list's record, or a contact of the same bot. */
export enum RecordLinkTargetKind {
  RECORD = 'record',
  CONTACT = 'contact',
}

/** One change to a record, as written to `record_events`. */
export enum RecordEventOp {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  RESTORE = 'restore',
}
