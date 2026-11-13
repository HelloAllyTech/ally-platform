import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, IsNull } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { Collection, CollectionSettings } from '../entity/collection.entity';
import { CollectionConstraint } from '../entity/collection-constraint.entity';
import {
  CollectionField,
  CollectionFieldPrivacy,
} from '../entity/collection-field.entity';
import { ListConstraintKind, ListFieldType } from '../enum/list.enum';
import {
  isContactRelation,
  KEY_SLUG,
  normaliseOptions,
  normaliseValue,
  relationTarget,
  RESERVED_FIELD_KEYS,
} from './list-fields';
import { LIMIT_WORDS, LIST_LIMITS } from './list-limits';
import { ListRefusalException, LIST_COPY, refuse } from './list-refusals';
import { findViolations, normaliseRuleConfig, ruleFields } from './list-rules';
import {
  LoadedList,
  loadList,
  loadListById,
  TitleResolver,
} from './list-store';

export interface ListFieldInput {
  key: string;
  label: string;
  type: ListFieldType;
  options?: Record<string, unknown>;
  required?: boolean;
  default?: unknown;
  privacy?: CollectionFieldPrivacy;
  agent_read?: boolean;
  agent_write?: boolean;
  position?: number;
}

export type ListFieldPatch = Partial<Omit<ListFieldInput, 'key'>>;

export interface ListInput {
  key: string;
  name: string;
  settings?: CollectionSettings;
  agent_read?: boolean;
  agent_write?: boolean;
  /** Fields to add with the list, in order. */
  fields?: ListFieldInput[];
}

export interface ListPatch {
  name?: string;
  settings?: CollectionSettings;
  agent_read?: boolean;
  agent_write?: boolean;
}

export interface ListRuleInput {
  kind: ListConstraintKind;
  config: Record<string, unknown>;
}

/** A list's definition as the owner API returns it. */
export interface ListDefinitionView {
  id: string;
  key: string;
  name: string;
  settings: CollectionSettings;
  agent_read: boolean;
  agent_write: boolean;
  deleted_at: string | null;
  record_count: number;
  fields: {
    key: string;
    label: string;
    type: ListFieldType;
    options: Record<string, unknown>;
    required: boolean;
    default: unknown;
    privacy: CollectionFieldPrivacy;
    agent_read: boolean;
    agent_write: boolean;
    position: number;
    archived_at: string | null;
  }[];
  rules: {
    id: string;
    kind: ListConstraintKind;
    config: Record<string, unknown>;
  }[];
}

const MAX_NAME = 120;

/**
 * A bot's lists, their fields and their rules (Agents v2, chunk 5a). Changes take the list's row
 * `FOR UPDATE`, so they never land between a record write's checks and its commit.
 */
@Injectable()
export class ListDefinitionsService {
  constructor(private readonly dataSource: DataSource) {}

  // ---- lists ----------------------------------------------------------------------------------

  async listLists(
    chatbotId: string,
    { includeDeleted = false } = {},
  ): Promise<ListDefinitionView[]> {
    const m = this.dataSource.manager;
    const collections = await m.find(Collection, {
      where: includeDeleted
        ? { chatbotId }
        : { chatbotId, deletedAt: IsNull() },
      order: { createdAt: 'ASC' },
    });
    const out: ListDefinitionView[] = [];
    for (const collection of collections) {
      const list = await loadListById(m, chatbotId, collection.id);
      if (list) out.push(await this.view(m, list));
    }
    return out;
  }

  async getList(chatbotId: string, key: string): Promise<ListDefinitionView> {
    const m = this.dataSource.manager;
    return this.view(m, await this.mustLoad(m, chatbotId, key));
  }

  async createList(
    chatbotId: string,
    input: ListInput,
  ): Promise<ListDefinitionView> {
    return this.dataSource.transaction(async (m) => {
      // One list definition change per bot at a time: keys and the list limit are per bot.
      await m.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `lists-bot:${chatbotId}`,
      ]);
      this.checkKey(input.key, 'The list key');
      const name = this.checkName(input.name, 'The name');
      const [{ n }] = await m.query(
        `SELECT count(*)::int AS n FROM collections WHERE chatbot_id = $1 AND deleted_at IS NULL`,
        [chatbotId],
      );
      if (n >= LIST_LIMITS.listsPerBot)
        throw refuse.limitExceeded(LIMIT_WORDS.listsPerBot);
      if (await loadList(m, chatbotId, input.key)) {
        throw refuse.invalidValue(
          'key',
          'The list key',
          `${input.key} is already used`,
        );
      }
      const collection = await m.save(Collection, {
        chatbotId,
        key: input.key,
        name,
        settings: {},
        agentRead: input.agent_read ?? false,
        agentWrite: input.agent_write ?? false,
      });
      for (const [i, field] of (input.fields ?? []).entries()) {
        await this.insertField(m, chatbotId, collection.id, {
          ...field,
          position: field.position ?? i,
        });
      }
      if (input.settings) {
        const list = (await loadListById(m, chatbotId, collection.id))!;
        await this.saveSettings(m, list, input.settings);
      }
      return this.view(m, (await loadListById(m, chatbotId, collection.id))!);
    });
  }

  async updateList(
    chatbotId: string,
    key: string,
    patch: ListPatch,
  ): Promise<ListDefinitionView> {
    return this.dataSource.transaction(async (m) => {
      const list = await this.mustLoad(m, chatbotId, key, true);
      const changes: Partial<Collection> = {};
      if (patch.name !== undefined)
        changes.name = this.checkName(patch.name, 'The name');
      if (patch.agent_read !== undefined)
        changes.agentRead = !!patch.agent_read;
      if (patch.agent_write !== undefined)
        changes.agentWrite = !!patch.agent_write;
      if (Object.keys(changes).length) {
        await m.update(Collection, { id: list.collection.id }, changes);
      }
      if (patch.settings !== undefined)
        await this.saveSettings(m, list, patch.settings);
      return this.view(
        m,
        (await loadListById(m, chatbotId, list.collection.id))!,
      );
    });
  }

  /** Soft delete: its records stay, and it can be restored for 30 days if its key is still free. */
  async deleteList(
    chatbotId: string,
    key: string,
  ): Promise<ListDefinitionView> {
    return this.dataSource.transaction(async (m) => {
      const list = await this.mustLoad(m, chatbotId, key, true);
      await m.update(
        Collection,
        { id: list.collection.id },
        { deletedAt: new Date() },
      );
      return this.view(
        m,
        (await loadListById(m, chatbotId, list.collection.id))!,
      );
    });
  }

  async restoreList(
    chatbotId: string,
    listId: string,
  ): Promise<ListDefinitionView> {
    return this.dataSource.transaction(async (m) => {
      await m.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `lists-bot:${chatbotId}`,
      ]);
      const list = /^[0-9a-f-]{36}$/i.test(listId)
        ? await loadListById(m, chatbotId, listId)
        : null;
      const deletedAt = list?.collection.deletedAt;
      if (
        !list ||
        !deletedAt ||
        Date.now() - new Date(deletedAt).getTime() >
          LIST_LIMITS.restoreDays * 86_400_000
      ) {
        throw refuse.notFound();
      }
      if (await loadList(m, chatbotId, list.collection.key)) {
        throw refuse.invalidValue(
          'key',
          'The list key',
          `another list uses ${list.collection.key} now`,
        );
      }
      const [{ n }] = await m.query(
        `SELECT count(*)::int AS n FROM collections WHERE chatbot_id = $1 AND deleted_at IS NULL`,
        [chatbotId],
      );
      if (n >= LIST_LIMITS.listsPerBot)
        throw refuse.limitExceeded(LIMIT_WORDS.listsPerBot);
      await m.update(
        Collection,
        { id: list.collection.id },
        { deletedAt: null },
      );
      return this.view(
        m,
        (await loadListById(m, chatbotId, list.collection.id))!,
      );
    });
  }

  // ---- fields ---------------------------------------------------------------------------------

  async addField(
    chatbotId: string,
    key: string,
    input: ListFieldInput,
  ): Promise<ListDefinitionView> {
    return this.dataSource.transaction(async (m) => {
      const list = await this.mustLoad(m, chatbotId, key, true);
      await this.insertField(m, chatbotId, list.collection.id, {
        ...input,
        position:
          input.position ??
          Math.max(-1, ...list.allFields.map((f) => f.position)) + 1,
      });
      return this.view(
        m,
        (await loadListById(m, chatbotId, list.collection.id))!,
      );
    });
  }

  async updateField(
    chatbotId: string,
    key: string,
    fieldKey: string,
    patch: ListFieldPatch,
  ): Promise<ListDefinitionView> {
    return this.dataSource.transaction(async (m) => {
      const list = await this.mustLoad(m, chatbotId, key, true);
      const field = list.field(fieldKey);
      if (!field) throw refuse.notFound();

      const type = patch.type ?? field.type;
      if (!Object.values(ListFieldType).includes(type)) {
        throw refuse.invalidValue(
          'type',
          field.label,
          `${String(type)} isn't a field type`,
        );
      }
      const options = normaliseOptions(
        field.key,
        patch.label ?? field.label,
        type,
        patch.options ??
          (patch.type && patch.type !== field.type ? {} : field.options),
      );
      const retargeted =
        type === ListFieldType.RELATION &&
        field.type === ListFieldType.RELATION &&
        relationTarget({ options }) !== relationTarget(field);
      if (
        (type !== field.type || retargeted) &&
        (await this.hasValues(m, list, field.key))
      ) {
        throw refuse.invalidValue(
          field.key,
          field.label,
          "its type can't change while entries have a value for it",
        );
      }
      if (type !== field.type || retargeted) {
        this.checkFieldNotInUse(list, field.key, 'change its type');
        await this.checkFieldNotUsedElsewhere(
          m,
          list,
          field.key,
          'change its type',
        );
      }
      if (type === ListFieldType.RELATION) {
        await this.checkRelationTarget(
          m,
          chatbotId,
          field.key,
          field.label,
          options,
        );
      }

      const draft = {
        key: field.key,
        label: patch.label ?? field.label,
        type,
        options,
      };
      const changes: QueryDeepPartialEntity<CollectionField> = {
        type,
        options: options as QueryDeepPartialEntity<Record<string, unknown>>,
      };
      if (patch.label !== undefined)
        changes.label = this.checkName(patch.label, 'The label');
      if (patch.required !== undefined) changes.required = !!patch.required;
      if (patch.default !== undefined || type !== field.type) {
        changes.default = (
          patch.default === undefined
            ? null
            : normaliseValue(draft, patch.default)
        ) as never;
      }
      if (patch.privacy !== undefined)
        changes.privacy = this.checkPrivacy(patch.privacy);
      if (patch.agent_read !== undefined)
        changes.agentRead = !!patch.agent_read;
      if (patch.agent_write !== undefined)
        changes.agentWrite = !!patch.agent_write;
      if (patch.position !== undefined)
        changes.position = this.checkPosition(patch.position);
      if (
        list.collection.settings?.person_field === field.key &&
        !isContactRelation({ type, options })
      ) {
        throw refuse.invalidValue(
          field.key,
          field.label,
          'it names the person each entry belongs to, so it stays a relation to a contact',
        );
      }
      await m.update(CollectionField, { id: field.id }, changes);
      return this.view(
        m,
        (await loadListById(m, chatbotId, list.collection.id))!,
      );
    });
  }

  /** Hidden from reads and writes; its values are kept. Refused while a rule or setting uses it. */
  async archiveField(
    chatbotId: string,
    key: string,
    fieldKey: string,
  ): Promise<ListDefinitionView> {
    return this.dataSource.transaction(async (m) => {
      const list = await this.mustLoad(m, chatbotId, key, true);
      const field = list.field(fieldKey);
      if (!field) throw refuse.notFound();
      this.checkFieldNotInUse(list, field.key, 'archive it');
      await this.checkFieldNotUsedElsewhere(m, list, field.key, 'archive it');
      await m.update(
        CollectionField,
        { id: field.id },
        { archivedAt: new Date() },
      );
      return this.view(
        m,
        (await loadListById(m, chatbotId, list.collection.id))!,
      );
    });
  }

  // ---- rules ----------------------------------------------------------------------------------

  /**
   * Checks the rule against the list's live records first. If any break it, they're returned in
   * the refusal (`conflict.records`) and the rule isn't added.
   */
  async addRule(
    chatbotId: string,
    key: string,
    input: ListRuleInput,
  ): Promise<ListDefinitionView> {
    return this.dataSource.transaction(async (m) => {
      const list = await this.mustLoad(m, chatbotId, key, true);
      if (!Object.values(ListConstraintKind).includes(input.kind)) {
        throw refuse.invalidValue(
          'kind',
          'The rule',
          `${String(input.kind)} isn't a kind of rule`,
        );
      }
      if (list.rules.length >= LIST_LIMITS.rulesPerList) {
        throw refuse.limitExceeded(LIMIT_WORDS.rulesPerList);
      }
      if (
        input.kind === ListConstraintKind.TRANSITIONS &&
        list.rules.some(
          (r) =>
            r.kind === ListConstraintKind.TRANSITIONS &&
            (r.config as { field?: string }).field === input.config?.field,
        )
      ) {
        throw refuse.invalidValue(
          undefined,
          'The rule',
          `${String(input.config?.field)} already has transitions`,
        );
      }
      const config = await normaliseRuleConfig(
        list,
        input.kind,
        input.config ?? {},
        (to) => loadList(m, chatbotId, to),
      );
      const offenders = await findViolations(m, list, input.kind, config);
      if (offenders.length) {
        const titles = new TitleResolver(m, chatbotId);
        const rows: { id: string; data: Record<string, unknown> }[] =
          await m.query(
            `SELECT id, data FROM collection_records WHERE id = ANY($1::uuid[])`,
            [offenders.slice(0, 50)],
          );
        await titles.preload(list, rows);
        const records = [];
        for (const row of rows) {
          records.push({
            id: row.id,
            title: await titles.title(list, row.data),
          });
        }
        const field = ruleFields({
          kind: input.kind,
          config,
        } as CollectionConstraint)[0];
        throw new ListRefusalException({
          code: 'invalid_value',
          field,
          message: LIST_COPY.invalid_value(
            'The rule',
            `${offenders.length} ${offenders.length === 1 ? 'entry already breaks' : 'entries already break'} it`,
          ),
          conflict: { records },
        });
      }
      await m.save(CollectionConstraint, {
        collectionId: list.collection.id,
        kind: input.kind,
        config,
      });
      return this.view(
        m,
        (await loadListById(m, chatbotId, list.collection.id))!,
      );
    });
  }

  async removeRule(
    chatbotId: string,
    key: string,
    ruleId: string,
  ): Promise<ListDefinitionView> {
    return this.dataSource.transaction(async (m) => {
      const list = await this.mustLoad(m, chatbotId, key, true);
      const rule = list.rules.find((r) => r.id === ruleId);
      if (!rule) throw refuse.notFound();
      await m.delete(CollectionConstraint, { id: rule.id });
      return this.view(
        m,
        (await loadListById(m, chatbotId, list.collection.id))!,
      );
    });
  }

  // ---- checks ---------------------------------------------------------------------------------

  private async mustLoad(
    m: EntityManager,
    chatbotId: string,
    key: string,
    forUpdate = false,
  ): Promise<LoadedList> {
    const list = await loadList(
      m,
      chatbotId,
      key,
      forUpdate ? 'update' : undefined,
    );
    if (!list) throw refuse.notFound();
    return list;
  }

  private checkKey(key: unknown, label: string): asserts key is string {
    if (typeof key !== 'string' || !KEY_SLUG.test(key)) {
      throw refuse.invalidValue(
        'key',
        label,
        'use lower case letters, digits and _, at most 40 characters',
      );
    }
  }

  private checkName(name: unknown, label: string): string {
    if (
      typeof name !== 'string' ||
      !name.trim() ||
      name.trim().length > MAX_NAME
    ) {
      throw refuse.invalidValue(
        undefined,
        label,
        `it needs 1 to ${MAX_NAME} characters`,
      );
    }
    return name.trim();
  }

  private checkPrivacy(privacy: unknown): CollectionFieldPrivacy {
    if (!privacy || typeof privacy !== 'object' || Array.isArray(privacy)) {
      throw refuse.invalidValue(
        'privacy',
        'Privacy',
        'it takes never_store and masked',
      );
    }
    const p = privacy as Record<string, unknown>;
    const out: CollectionFieldPrivacy = {};
    for (const [k, v] of Object.entries(p)) {
      if ((k !== 'never_store' && k !== 'masked') || typeof v !== 'boolean') {
        throw refuse.invalidValue(
          'privacy',
          'Privacy',
          'it takes never_store and masked, each yes or no',
        );
      }
      if (v) out[k] = true;
    }
    return out;
  }

  private checkPosition(position: unknown): number {
    if (
      typeof position !== 'number' ||
      !Number.isInteger(position) ||
      position < 0 ||
      position > 10_000
    ) {
      throw refuse.invalidValue(
        'position',
        'The position',
        'it is a whole number from 0',
      );
    }
    return position;
  }

  private async checkRelationTarget(
    m: EntityManager,
    chatbotId: string,
    key: string,
    label: string,
    options: Record<string, unknown>,
  ): Promise<void> {
    const to = relationTarget({ options });
    if (to !== 'contact' && !(await loadList(m, chatbotId, to))) {
      throw refuse.invalidValue(
        key,
        label,
        `this bot has no list called ${to}`,
      );
    }
  }

  private async insertField(
    m: EntityManager,
    chatbotId: string,
    collectionId: string,
    input: ListFieldInput,
  ): Promise<void> {
    this.checkKey(input.key, 'The field key');
    if (RESERVED_FIELD_KEYS.has(input.key)) {
      throw refuse.invalidValue(
        'key',
        'The field key',
        `${input.key} is kept for the entry itself`,
      );
    }
    const label = this.checkName(input.label, 'The label');
    if (!Object.values(ListFieldType).includes(input.type)) {
      throw refuse.invalidValue(
        'type',
        label,
        `${String(input.type)} isn't a field type`,
      );
    }
    const [{ n, taken }] = await m.query(
      `SELECT count(*) FILTER (WHERE archived_at IS NULL)::int AS n,
              bool_or(key = $2) AS taken
         FROM collection_fields WHERE collection_id = $1`,
      [collectionId, input.key],
    );
    if (taken)
      throw refuse.invalidValue(
        'key',
        'The field key',
        `${input.key} is already used`,
      );
    if (n >= LIST_LIMITS.fieldsPerList)
      throw refuse.limitExceeded(LIMIT_WORDS.fieldsPerList);
    const options = normaliseOptions(
      input.key,
      label,
      input.type,
      input.options,
    );
    if (input.type === ListFieldType.RELATION) {
      await this.checkRelationTarget(m, chatbotId, input.key, label, options);
    }
    const draft = { key: input.key, label, type: input.type, options };
    await m.save(CollectionField, {
      collectionId,
      key: input.key,
      label,
      type: input.type,
      options,
      required: !!input.required,
      default:
        input.default === undefined
          ? null
          : (normaliseValue(draft, input.default) as never),
      privacy: this.checkPrivacy(input.privacy ?? {}),
      agentRead: input.agent_read ?? true,
      agentWrite: input.agent_write ?? false,
      position: this.checkPosition(input.position ?? 0),
    });
  }

  /** Settings name live fields; the person field can't change once the list has records. */
  private async saveSettings(
    m: EntityManager,
    list: LoadedList,
    settings: CollectionSettings,
  ): Promise<void> {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      throw refuse.invalidValue(
        'settings',
        'The settings',
        'they take title_field, default_sort and person_field',
      );
    }
    const out: CollectionSettings = {};
    for (const [k, v] of Object.entries(settings)) {
      if (v === null || v === undefined || v === '') continue;
      if (k === 'title_field') {
        if (!list.field(String(v)))
          throw refuse.invalidValue(
            'settings',
            'The title field',
            `${String(v)} isn't a field`,
          );
        out.title_field = String(v);
      } else if (k === 'default_sort') {
        if (!list.field(String(v).replace(/^-/, ''))) {
          throw refuse.invalidValue(
            'settings',
            'The default sort',
            `${String(v)} isn't a field`,
          );
        }
        out.default_sort = String(v);
      } else if (k === 'person_field') {
        const field = list.field(String(v));
        if (!field || !isContactRelation(field)) {
          throw refuse.invalidValue(
            'settings',
            'The person field',
            'it must be a relation to a contact',
          );
        }
        out.person_field = field.key;
      } else {
        throw refuse.invalidValue(
          'settings',
          'The settings',
          `${k} isn't a setting`,
        );
      }
    }
    const before = list.collection.settings?.person_field;
    if (before !== out.person_field && (await this.hasRecords(m, list))) {
      throw refuse.invalidValue(
        'settings',
        'The person field',
        "it can't change once the list has entries",
      );
    }
    await m.update(Collection, { id: list.collection.id }, { settings: out });
  }

  private async hasRecords(
    m: EntityManager,
    list: LoadedList,
  ): Promise<boolean> {
    const rows = await m.query(
      `SELECT 1 FROM collection_records WHERE collection_id = $1 LIMIT 1`,
      [list.collection.id],
    );
    return rows.length > 0;
  }

  private async hasValues(
    m: EntityManager,
    list: LoadedList,
    key: string,
  ): Promise<boolean> {
    const rows = await m.query(
      `SELECT 1 FROM collection_records WHERE collection_id = $1 AND data ? $2 LIMIT 1`,
      [list.collection.id, key],
    );
    return rows.length > 0;
  }

  private checkFieldNotInUse(
    list: LoadedList,
    key: string,
    doing: string,
  ): void {
    const settings = list.collection.settings ?? {};
    const inSettings = [
      settings.title_field,
      settings.person_field,
      settings.default_sort?.replace(/^-/, ''),
    ].includes(key);
    if (inSettings || list.rules.some((r) => ruleFields(r).includes(key))) {
      const field = list.field(key)!;
      throw refuse.invalidValue(
        key,
        field.label,
        `a rule or the list's settings use it, so you can't ${doing}`,
      );
    }
  }

  /** Another list's capacity rule may read this field as its `max_from`. */
  private async checkFieldNotUsedElsewhere(
    m: EntityManager,
    list: LoadedList,
    key: string,
    doing: string,
  ): Promise<void> {
    const rows = await m.query(
      `SELECT k.config FROM collection_constraints k
         JOIN collections c ON c.id = k.collection_id
         JOIN collection_fields f ON f.collection_id = c.id AND f.key = k.config->>'field'
        WHERE c.chatbot_id = $1 AND c.deleted_at IS NULL AND k.kind = 'capacity'
          AND k.config->>'max_from' = $2 AND f.options->>'to' = $3`,
      [list.collection.chatbotId, key, list.collection.key],
    );
    if (rows.length) {
      const field = list.field(key)!;
      throw refuse.invalidValue(
        key,
        field.label,
        `another list's capacity rule reads it, so you can't ${doing}`,
      );
    }
  }

  private async view(
    m: EntityManager,
    list: LoadedList,
  ): Promise<ListDefinitionView> {
    const [{ n }] = await m.query(
      `SELECT count(*)::int AS n FROM collection_records WHERE collection_id = $1 AND deleted_at IS NULL`,
      [list.collection.id],
    );
    const c = list.collection;
    return {
      id: c.id,
      key: c.key,
      name: c.name,
      settings: c.settings ?? {},
      agent_read: c.agentRead,
      agent_write: c.agentWrite,
      deleted_at: c.deletedAt ? new Date(c.deletedAt).toISOString() : null,
      record_count: n,
      fields: [...list.allFields]
        .sort((a, b) => a.position - b.position || a.key.localeCompare(b.key))
        .map((f) => ({
          key: f.key,
          label: f.label,
          type: f.type,
          options: f.options ?? {},
          required: f.required,
          default: f.default ?? null,
          privacy: f.privacy ?? {},
          agent_read: f.agentRead,
          agent_write: f.agentWrite,
          position: f.position,
          archived_at: f.archivedAt
            ? new Date(f.archivedAt).toISOString()
            : null,
        })),
      rules: list.rules.map((r) => ({
        id: r.id,
        kind: r.kind,
        config: r.config,
      })),
    };
  }
}
