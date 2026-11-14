import type { EntityManager } from 'typeorm';
import { IsNull } from 'typeorm';
import { Collection } from '../entity/collection.entity';
import { CollectionConstraint } from '../entity/collection-constraint.entity';
import { CollectionField } from '../entity/collection-field.entity';
import { ListFieldType } from '../enum/list.enum';
import { displayValue, relationTarget } from './list-fields';

/** A list with its live fields (by position), every field, and its rules. */
export class LoadedList {
  readonly fields: CollectionField[];
  private readonly byKey: Map<string, CollectionField>;

  constructor(
    readonly collection: Collection,
    readonly allFields: CollectionField[],
    readonly rules: CollectionConstraint[],
  ) {
    this.fields = allFields
      .filter((f) => !f.archivedAt)
      .sort((a, b) => a.position - b.position || a.key.localeCompare(b.key));
    this.byKey = new Map(this.fields.map((f) => [f.key, f]));
  }

  /** A live field by key; archived fields are hidden. */
  field(key: string | undefined): CollectionField | undefined {
    return key ? this.byKey.get(key) : undefined;
  }

  get personField(): CollectionField | undefined {
    return this.field(this.collection.settings?.person_field);
  }
}

async function load(
  manager: EntityManager,
  collection: Collection | null,
): Promise<LoadedList | null> {
  if (!collection) return null;
  const [fields, rules] = await Promise.all([
    manager.find(CollectionField, {
      where: { collectionId: collection.id },
    }),
    manager.find(CollectionConstraint, {
      where: { collectionId: collection.id },
      order: { createdAt: 'ASC' },
    }),
  ]);
  return new LoadedList(collection, fields, rules);
}

/**
 * A live list of this bot by key. Another bot's key never resolves.
 *
 * `lock` (inside a transaction): a record write takes the list's row `FOR SHARE`, a definition
 * change `FOR UPDATE`. Writes run side by side, but a new rule or field change waits for them, and
 * they wait for it: a rule is never added between a write's check and its commit.
 */
export async function loadList(
  manager: EntityManager,
  chatbotId: string,
  key: string,
  lock?: 'share' | 'update',
): Promise<LoadedList | null> {
  return load(
    manager,
    await manager.findOne(Collection, {
      where: { chatbotId, key, deletedAt: IsNull() },
      ...(lock
        ? {
            lock: {
              mode: lock === 'share' ? 'pessimistic_read' : 'pessimistic_write',
            },
          }
        : {}),
    }),
  );
}

export async function loadListById(
  manager: EntityManager,
  chatbotId: string,
  id: string,
): Promise<LoadedList | null> {
  return load(
    manager,
    await manager.findOne(Collection, { where: { chatbotId, id } }),
  );
}

interface RecordRow {
  id: string;
  collection_id: string;
  data: Record<string, unknown>;
}

/**
 * Renders records' titles, following relations: an appointment's title is its slot's title, a
 * slot's is its start time. Everything it loads is scoped to one bot, and cached for one call.
 */
export class TitleResolver {
  private readonly listsById = new Map<string, Promise<LoadedList | null>>();
  private readonly listsByKey = new Map<string, Promise<LoadedList | null>>();
  private readonly records = new Map<string, RecordRow | null>();
  private readonly contacts = new Map<string, string | null>();

  constructor(
    private readonly manager: EntityManager,
    private readonly chatbotId: string,
    /** The agent is reading: titles use only fields it may see whole. */
    private readonly agent = false,
  ) {}

  /** Whether the reader may see this field's value (masked values included, for the agent). */
  canSee(list: LoadedList, field: CollectionField): boolean {
    return (
      !this.agent ||
      (list.collection.agentRead &&
        field.agentRead &&
        !field.privacy?.never_store)
    );
  }

  listByKey(key: string): Promise<LoadedList | null> {
    let list = this.listsByKey.get(key);
    if (!list) {
      list = loadList(this.manager, this.chatbotId, key);
      this.listsByKey.set(key, list);
    }
    return list;
  }

  private listById(id: string): Promise<LoadedList | null> {
    let list = this.listsById.get(id);
    if (!list) {
      list = loadListById(this.manager, this.chatbotId, id);
      this.listsById.set(id, list);
    }
    return list;
  }

  /** Loads what the given values point at, in two queries, before titles are read. */
  async preload(
    list: LoadedList,
    rows: { data: Record<string, unknown> }[],
  ): Promise<void> {
    const recordIds = new Set<string>();
    const contactIds = new Set<string>();
    for (const field of list.fields) {
      if (field.type !== ListFieldType.RELATION) continue;
      const toContact = relationTarget(field) === 'contact';
      for (const row of rows) {
        const value = row.data?.[field.key];
        if (typeof value !== 'string') continue;
        (toContact ? contactIds : recordIds).add(value);
      }
    }
    const newRecords = [...recordIds].filter((id) => !this.records.has(id));
    if (newRecords.length) {
      const found: RecordRow[] = await this.manager.query(
        `SELECT id, collection_id, data FROM collection_records
          WHERE chatbot_id = $1 AND id = ANY($2::uuid[])`,
        [this.chatbotId, newRecords],
      );
      for (const id of newRecords) this.records.set(id, null);
      for (const row of found) this.records.set(row.id, row);
    }
    const newContacts = [...contactIds].filter((id) => !this.contacts.has(id));
    if (newContacts.length) {
      const found: ContactRow[] = await this.manager.query(
        `${CONTACT_SELECT} WHERE c.chatbot_id = $1 AND c.id = ANY($2::uuid[])`,
        [this.chatbotId, newContacts],
      );
      for (const id of newContacts) this.contacts.set(id, null);
      for (const row of found) {
        // People read the inbox's label (chunk 5b); the agent keeps the name alone.
        this.contacts.set(
          row.id,
          this.agent ? (row.display_name ?? 'A contact') : contactLabel(row),
        );
      }
    }
  }

  /** A value for display: a relation shows its target's title. */
  async display(
    field: CollectionField,
    value: unknown,
    depth = 0,
  ): Promise<string> {
    if (field.type !== ListFieldType.RELATION || typeof value !== 'string') {
      return displayValue(field, value);
    }
    if (relationTarget(field) === 'contact') {
      return this.contacts.get(value) ?? 'A contact';
    }
    const row = this.records.get(value);
    if (!row || depth >= 2) return value;
    const target = await this.listById(row.collection_id);
    if (!target) return value;
    await this.preload(target, [row]);
    return this.title(target, row.data, depth + 1);
  }

  /**
   * A record's title: its title field, rendered. If that field is empty or the reader may not see
   * it whole (a masked field, for the agent), the first field it may see that has a value;
   * failing that, the list's name.
   */
  async title(
    list: LoadedList,
    data: Record<string, unknown>,
    depth = 0,
  ): Promise<string> {
    const readable = (field: CollectionField) =>
      this.canSee(list, field) && !(this.agent && field.privacy?.masked);
    const titleField = list.field(list.collection.settings?.title_field);
    const candidates = [
      ...(titleField ? [titleField] : []),
      ...list.fields.filter((f) => f !== titleField),
    ];
    for (const field of candidates) {
      const value = data?.[field.key];
      if (value === null || value === undefined || !readable(field)) continue;
      return this.display(field, value, depth);
    }
    return list.collection.name;
  }
}

/** A contact as the owner's screens label it: its name and channel (chunk 5b). */
export interface ContactRow {
  id: string;
  display_name: string | null;
  /** The WhatsApp number, if the contact has one: only its last 4 are ever shown. */
  whatsapp: string | null;
  channel: string | null;
}

/** A contact, with its WhatsApp identity and the channel it was first seen on. */
export const CONTACT_SELECT = `SELECT c.id, c.display_name,
    (SELECT i.external_id FROM chatbot_contact_identities i
      WHERE i.contact_id = c.id AND i.channel = 'whatsapp' ORDER BY i."createdAt" LIMIT 1) AS whatsapp,
    (SELECT i.channel FROM chatbot_contact_identities i
      WHERE i.contact_id = c.id ORDER BY i."createdAt" LIMIT 1) AS channel
  FROM chatbot_contacts c`;

/** Four digits from an id, the same every time, as the inbox tags a visitor. */
function tag(id: string): string {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return String(hash % 10000).padStart(4, '0');
}

/**
 * The inbox's label for a person (20d-2): their name, else "Visitor · 4821" with a WhatsApp
 * number's last 4, else 4 digits from the contact's id. Never a whole number or email.
 */
export function contactLabel(row: ContactRow): string {
  if (row.display_name?.trim()) return row.display_name.trim();
  const phone = String(row.whatsapp ?? '');
  return `Visitor · ${/\d{4}$/.test(phone) ? phone.slice(-4) : tag(row.id)}`;
}

/** The channel a contact came from, in the owner's words. */
export function contactChannel(row: ContactRow): string {
  if (row.whatsapp || row.channel === 'whatsapp') return 'WhatsApp';
  if (row.channel === 'email') return 'Email';
  return 'Bot page';
}
