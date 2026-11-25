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
        // TF1 round 2 (Saathi B-4): the agent and the person's card read the same label as the
        // owner (never "A contact" for someone with a name, email or number).
        this.contacts.set(row.id, contactLabel(row));
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
    const title = await this.title(target, row.data, depth + 1);
    const name = this.nameBesideTime(target, row.data);
    return name ? `${title} · ${name}` : title;
  }

  /**
   * What tells apart entries that share a time (Q3-fast Part 0b, 17 Nov C21): on a list titled by
   * its date and time, its first required text field ("Table" on Tables). A reservation's title is
   * then "Sat 21 Nov 2026, 20:00 · Table 1", not just the time. Lists titled otherwise, or with no
   * such field (Slots), are unchanged.
   */
  private nameBesideTime(
    list: LoadedList,
    data: Record<string, unknown>,
  ): string | null {
    const titleField = list.field(list.collection.settings?.title_field);
    if (
      titleField?.type !== ListFieldType.DATETIME &&
      titleField?.type !== ListFieldType.DATE
    ) {
      return null;
    }
    const name = list.fields.find(
      (f) =>
        f.type === ListFieldType.TEXT && f.required && this.canSee(list, f),
    );
    const value = name ? data?.[name.key] : undefined;
    return typeof value === 'string' && value.trim() ? value.trim() : null;
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
  /** The WhatsApp number, if the contact has one. */
  whatsapp: string | null;
  /** Their verified email (the bot page's sign-in), if any. */
  email?: string | null;
  channel: string | null;
}

/** A contact, with its WhatsApp identity and the channel it was first seen on. */
export const CONTACT_SELECT = `SELECT c.id, c.display_name,
    (SELECT i.external_id FROM chatbot_contact_identities i
      WHERE i.contact_id = c.id AND i.channel = 'whatsapp' ORDER BY i."createdAt" LIMIT 1) AS whatsapp,
    (SELECT i.external_id FROM chatbot_contact_identities i
      WHERE i.contact_id = c.id AND i.channel = 'email' AND i.verified
      ORDER BY i."createdAt" LIMIT 1) AS email,
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
 * Who a person is, as the Inbox says it (TF1 S5; lists and cards since TF1 round 2, Saathi B-4):
 * their name, else their verified email, else their WhatsApp number. "Visitor · 4821" only for
 * someone with none of those (never for a signed-in person).
 */
export function contactLabel(row: ContactRow): string {
  if (row.display_name?.trim()) return row.display_name.trim();
  if (row.email?.trim()) return row.email.trim();
  const phone = String(row.whatsapp ?? '').replace(/\D/g, '');
  if (/^\d{8,15}$/.test(phone)) return `+${phone}`;
  return `Visitor · ${tag(row.id)}`;
}

/** The channel a contact came from, in the owner's words. */
export function contactChannel(row: ContactRow): string {
  if (row.whatsapp || row.channel === 'whatsapp') return 'WhatsApp';
  if (row.channel === 'email') return 'Email';
  return 'Bot page';
}
