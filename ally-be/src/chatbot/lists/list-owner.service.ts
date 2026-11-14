import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import {
  abilityFor,
  DEFAULT_TIME_ZONE,
  listToolName,
} from '../agent-tools/list-tools';
import { Collection } from '../entity/collection.entity';
import type { Chatbot } from '../entity/chatbot.entity';
import { ListFieldType } from '../enum/list.enum';
import { handoverOf } from '../handover/handover';
import { ChatbotSettingsService } from '../service/chatbot-settings.service';
import type { ChatbotSettingsOverride } from '../type/chatbot.type';
import {
  ListDefinitionsService,
  ListDefinitionView,
} from './list-definitions.service';
import { displayValue } from './list-fields';
import { ListRecordsService } from './list-records.service';
import { refuse } from './list-refusals';
import {
  CONTACT_SELECT,
  contactChannel,
  contactLabel,
  ContactRow,
  loadList,
} from './list-store';
import type { ListActor } from './list-types';
import {
  exampleOptions,
  HEALTH_PACKS,
  listInputFor,
  READY_MADE,
  READY_MADE_GROUPS,
  readyMade,
} from './ready-made-lists';

export type Ability = 'do_it' | 'never';

/** What the assistant may do with one list, as the owner's switches show it (chunk 5b). */
export interface ListAbilities {
  find: Ability;
  create: Ability;
  update: Ability;
}

/** A list as the owner's screens get it: its definition, the assistant's switches and the zone. */
export type OwnerListView = ListDefinitionView & {
  abilities: ListAbilities;
  time_zone: string;
};

export interface RepeatInput {
  field: string;
  /** ISO weekdays: 1 Monday … 7 Sunday. */
  days: number[];
  start: string;
  end: string;
  every_minutes: number;
  from?: string;
  until: string;
  values?: Record<string, unknown>;
  dry_run?: boolean;
}

export interface RepeatResult {
  count: number;
  skipped: number;
  first: string[];
  dry_run: boolean;
}

/** Repeat weekly until adds at most this many entries at a time (chunk 5b). */
export const REPEAT_MAX = 500;
export const REPEAT_LIMIT_WORDS = '500 entries at a time';
const REPEAT_MAX_DAYS = 366;
const REPEAT_FIRST = 5;
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

const pad = (n: number) => String(n).padStart(2, '0');

/** A valid IANA zone, or the default. */
export function zoneOrDefault(zone: string | undefined | null): string {
  if (!zone) return DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: zone });
    return zone;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

/** The zone's offset from UTC at an instant, in minutes. */
function offsetMinutes(zone: string, at: Date): number {
  const name =
    new Intl.DateTimeFormat('en-GB', {
      timeZone: zone,
      timeZoneName: 'longOffset',
    })
      .formatToParts(at)
      .find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  const m = /([+-])(\d{2}):?(\d{2})?/.exec(name);
  if (!m) return 0;
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0));
}

/** Today's date in the zone, as YYYY-MM-DD. */
export function todayIn(zone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return parts;
}

/**
 * A wall time in the zone as stored values are written: "2026-11-19T11:00:00+05:30", with the
 * offset that applies at that time (summer time included), and its instant.
 */
export function wallTime(
  zone: string,
  date: string,
  minutes: number,
): { value: string; at: number } {
  const [y, mo, d] = date.split('-').map(Number);
  const guess = Date.UTC(y, mo - 1, d, Math.floor(minutes / 60), minutes % 60);
  let off = offsetMinutes(zone, new Date(guess));
  const second = offsetMinutes(zone, new Date(guess - off * 60_000));
  if (second !== off) off = second;
  const sign = off < 0 ? '-' : '+';
  const abs = Math.abs(off);
  return {
    value: `${date}T${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}:00${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`,
    at: guess - off * 60_000,
  };
}

function validDay(s: string | undefined): s is string {
  const m = s ? YMD.exec(s) : null;
  if (!m) return false;
  const date = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return date.getUTCMonth() === +m[2] - 1 && date.getUTCDate() === +m[3];
}

const minutesOf = (hhmm: string): number => {
  const m = HHMM.exec(hhmm)!;
  return Number(m[1]) * 60 + Number(m[2]);
};

const addDays = (date: string, n: number): string => {
  const [y, m, d] = date.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + n));
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
};

/**
 * What the owner's Lists section needs beyond 5a's API (chunk 5b): the assistant's switches per
 * list, ready-made lists, and Repeat weekly until. Every write goes through 5a's engine and
 * definitions, so the rules hold.
 */
@Injectable()
export class ListOwnerService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly definitions: ListDefinitionsService,
    private readonly records: ListRecordsService,
    private readonly settings: ChatbotSettingsService,
  ) {}

  /** Where the business is: the hand-over hours' zone, as the agent's `{today}` uses it. */
  async timeZone(
    chatbot: Pick<Chatbot, 'settings'> & Partial<Pick<Chatbot, 'safetyPack'>>,
  ): Promise<string> {
    const effective = await this.settings.getForChatbot(chatbot);
    return zoneOrDefault(handoverOf(effective).hours?.timeZone);
  }

  abilitiesOf(
    stored: ChatbotSettingsOverride | null | undefined,
    key: string,
  ): ListAbilities {
    return {
      find: abilityFor(stored, listToolName('find', key)),
      create: abilityFor(stored, listToolName('create', key)),
      update: abilityFor(stored, listToolName('update', key)),
    };
  }

  /** Lists as the owner's screens get them: with the assistant's switches and the bot's zone. */
  async decorate<T extends ListDefinitionView | ListDefinitionView[]>(
    chatbot: Pick<Chatbot, 'settings'> & Partial<Pick<Chatbot, 'safetyPack'>>,
    views: T,
  ): Promise<T extends ListDefinitionView[] ? OwnerListView[] : OwnerListView> {
    const zone = await this.timeZone(chatbot);
    const one = (view: ListDefinitionView): OwnerListView => ({
      ...view,
      abilities: this.abilitiesOf(chatbot.settings, view.key),
      time_zone: zone,
    });
    return (Array.isArray(views) ? views.map(one) : one(views)) as never;
  }

  // ---- the assistant's switches ----------------------------------------------------------------

  /**
   * An owner's Do it / Never for one list (chunk 5b): only that list's `find_`, `create_` and
   * `update_` keys change, never `hand_over` or another list's. The list's agent switches follow:
   * read when Look up is on, write when Add or Change is.
   */
  async setAbilities(
    chatbotId: string,
    key: string,
    change: Partial<ListAbilities>,
  ): Promise<OwnerListView> {
    const stored = await this.dataSource.transaction(async (m) => {
      const list = await loadList(m, chatbotId, key, 'update');
      if (!list) throw refuse.notFound();
      const [row] = await m.query(
        `SELECT settings FROM chatbots WHERE id = $1 FOR UPDATE`,
        [chatbotId],
      );
      const current = this.abilitiesOf(row?.settings, key);
      const next: ListAbilities = { ...current, ...change };
      const writes = next.create === 'do_it' || next.update === 'do_it';
      if (writes && !list.fields.some((f) => f.agentWrite)) {
        throw refuse.invalidValue(
          undefined,
          list.collection.name,
          'no detail lets your assistant fill it in',
        );
      }
      await m.update(
        Collection,
        { id: list.collection.id },
        { agentRead: next.find === 'do_it', agentWrite: writes },
      );
      return this.writeAbilities(m, chatbotId, {
        [listToolName('find', key)]: next.find,
        [listToolName('create', key)]: next.create,
        [listToolName('update', key)]: next.update,
      });
    });
    const view = await this.definitions.getList(chatbotId, key);
    const chatbot = await this.dataSource.manager.query(
      `SELECT safety_pack AS "safetyPack" FROM chatbots WHERE id = $1`,
      [chatbotId],
    );
    return this.decorate(
      { settings: stored, safetyPack: chatbot[0]?.safetyPack ?? null },
      view,
    );
  }

  /** Merges list-tool abilities into the bot's stored settings, in the caller's transaction. */
  private async writeAbilities(
    m: EntityManager,
    chatbotId: string,
    entries: Record<string, Ability>,
  ): Promise<ChatbotSettingsOverride> {
    const [row] = await m.query(
      `SELECT settings FROM chatbots WHERE id = $1 FOR UPDATE`,
      [chatbotId],
    );
    const settings: ChatbotSettingsOverride = { ...(row?.settings ?? {}) };
    settings.abilities = { ...(settings.abilities ?? {}), ...entries };
    await m.query(`UPDATE chatbots SET settings = $2::jsonb WHERE id = $1`, [
      chatbotId,
      JSON.stringify(settings),
    ]);
    return settings;
  }

  // ---- people, for "linked to a person" --------------------------------------------------------

  /**
   * This bot's contacts for the entry form's person picker (chunk 5b), most recent first. Matches
   * a name, a phone number or an email, ignoring case, but shows only the inbox's label and the
   * channel: never a whole number or address.
   */
  async contacts(
    chatbotId: string,
    search = '',
    limit = 20,
  ): Promise<{ contacts: { id: string; name: string; hint: string }[] }> {
    const term = search.trim().slice(0, 100);
    const pattern = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const rows: ContactRow[] = await this.dataSource.manager.query(
      `${CONTACT_SELECT}
        WHERE c.chatbot_id = $1
          AND ($2 = '' OR c.display_name ILIKE $3 ESCAPE '\\'
               OR EXISTS (SELECT 1 FROM chatbot_contact_identities ci
                           WHERE ci.contact_id = c.id AND ci.external_id ILIKE $3 ESCAPE '\\'))
        ORDER BY COALESCE((SELECT max(v.last_message_at) FROM chatbot_conversations v
                            WHERE v.contact_id = c.id), c."createdAt") DESC, c.id
        LIMIT $4`,
      [chatbotId, term, pattern, Math.min(Math.max(limit || 20, 1), 50)],
    );
    return {
      contacts: rows.map((row) => ({
        id: row.id,
        name: contactLabel(row),
        hint: contactChannel(row),
      })),
    };
  }

  // ---- ready-made lists ------------------------------------------------------------------------

  /** The catalogue as the picker shows it, grouped as `READY-MADE-LISTS.md` groups it. */
  catalogue() {
    return {
      groups: READY_MADE_GROUPS.map((group) => ({
        name: group,
        items: READY_MADE.filter((item) => item.group === group).map(
          (item) => ({
            name: item.name,
            title: item.title,
            one_liner: item.one_liner,
            examples: item.examples,
            lists: item.lists.map((list) => ({
              key: list.key,
              name: list.name,
              fields: list.fields.map((f) => ({
                key: f.key,
                label: f.label,
                type: f.type,
                required: !!f.required,
              })),
            })),
            needs_options: exampleOptions(item),
          }),
        ),
      })),
    };
  }

  /**
   * Installs a ready-made list (and the list it points at) in one transaction, with no entries:
   * definitions, rules, and the assistant's switches (Look up as the catalogue says; Add and
   * Change at Never). A list with the same key already there is a refusal, not an overwrite.
   */
  async install(
    chatbot: Pick<Chatbot, 'id' | 'settings'> &
      Partial<Pick<Chatbot, 'safetyPack'>>,
    name: string,
    options?: Record<string, Record<string, string[]>>,
  ): Promise<{ lists: OwnerListView[] }> {
    const item = readyMade(name);
    if (!item) {
      throw refuse.invalidValue(
        undefined,
        'The ready-made list',
        `there's none called ${name}`,
      );
    }
    const health = HEALTH_PACKS.has(chatbot.safetyPack ?? '');
    const { views, settings } = await this.dataSource.transaction(async (m) => {
      for (const list of item.lists) {
        if (await loadList(m, chatbot.id, list.key)) {
          throw refuse.invalidValue(
            'key',
            list.name,
            "there's already a list with this name",
          );
        }
      }
      const views: ListDefinitionView[] = [];
      for (const list of item.lists) {
        const { rules, ...input } = listInputFor(list, {
          health,
          options: options?.[list.key],
        });
        await this.definitions.createList(chatbot.id, input, { manager: m });
        let view: ListDefinitionView | undefined;
        for (const rule of rules) {
          view = await this.definitions.addRule(chatbot.id, list.key, rule, {
            manager: m,
          });
        }
        views.push(
          view ?? (await this.definitions.getListIn(m, chatbot.id, list.key)),
        );
      }
      const settings = await this.writeAbilities(
        m,
        chatbot.id,
        Object.fromEntries(
          item.lists.flatMap((list) => [
            [
              listToolName('find', list.key),
              list.agent_read ? 'do_it' : 'never',
            ],
            [listToolName('create', list.key), 'never'],
            [listToolName('update', list.key), 'never'],
          ]),
        ),
      );
      return { views, settings };
    });
    return {
      lists: await this.decorate(
        { settings, safetyPack: chatbot.safetyPack },
        views,
      ),
    };
  }

  // ---- Repeat weekly until --------------------------------------------------------------------

  /**
   * Adds an entry for each chosen weekday and time, from `from` (today) to `until`, every N
   * minutes from `start` while before `end`, in the business's zone. Times that already have an
   * entry, and times already past, are left out. Nothing is stored about the repeat: these are
   * ordinary entries, written through the engine in one transaction (all or none).
   */
  async repeat(
    chatbot: Pick<Chatbot, 'id' | 'settings'> &
      Partial<Pick<Chatbot, 'safetyPack'>>,
    key: string,
    actor: ListActor,
    input: RepeatInput,
    now = new Date(),
  ): Promise<RepeatResult> {
    const zone = await this.timeZone(chatbot);
    const m0 = this.dataSource.manager;
    const list = await loadList(m0, chatbot.id, key);
    if (!list) throw refuse.notFound();
    const field = list.field(input.field);
    if (!field || field.type !== ListFieldType.DATETIME) {
      throw refuse.invalidValue(
        input.field,
        field?.label ?? 'The field',
        'it should be a date and time',
      );
    }
    const days = [...new Set(input.days ?? [])];
    if (
      !days.length ||
      days.some((d) => !Number.isInteger(d) || d < 1 || d > 7)
    ) {
      throw refuse.invalidValue(
        'days',
        'The days',
        'choose at least one day of the week',
      );
    }
    if (!HHMM.test(input.start ?? '') || !HHMM.test(input.end ?? '')) {
      throw refuse.invalidValue(
        'start',
        'The times',
        'they should be like 10:00',
      );
    }
    const start = minutesOf(input.start);
    const end = minutesOf(input.end);
    if (end <= start) {
      throw refuse.invalidValue(
        'end',
        'The end time',
        'it should be after the start',
      );
    }
    const every = input.every_minutes;
    if (!Number.isInteger(every) || every < 5 || every > 720) {
      throw refuse.invalidValue(
        'every_minutes',
        'Every',
        'it should be 5 to 720 minutes',
      );
    }
    const from = input.from ?? todayIn(zone, now);
    if (!validDay(from) || !validDay(input.until) || input.until < from) {
      throw refuse.invalidValue(
        'until',
        'The end date',
        'it should be a date like 2026-11-20, on or after the start',
      );
    }
    const times: { value: string; at: number }[] = [];
    for (
      let day = from, i = 0;
      day <= input.until;
      day = addDays(day, 1), i++
    ) {
      if (i >= REPEAT_MAX_DAYS) {
        throw refuse.invalidValue(
          'until',
          'The end date',
          'it should be within a year',
        );
      }
      const [y, mo, d] = day.split('-').map(Number);
      const weekday =
        ((new Date(Date.UTC(y, mo - 1, d)).getUTCDay() + 6) % 7) + 1;
      if (!days.includes(weekday)) continue;
      for (let t = start; t < end; t += every) {
        const time = wallTime(zone, day, t);
        if (time.at > now.getTime()) times.push(time);
      }
    }

    const plan = async (m: EntityManager) => {
      if (!times.length) return { add: [], skipped: 0 };
      const rows: { at: Date }[] = await m.query(
        `SELECT DISTINCT (data->>$2)::timestamptz AS at FROM collection_records
          WHERE collection_id = $1 AND deleted_at IS NULL AND data ? $2
            AND (data->>$2)::timestamptz BETWEEN $3 AND $4`,
        [
          list.collection.id,
          field.key,
          new Date(times[0].at).toISOString(),
          new Date(times[times.length - 1].at).toISOString(),
        ],
      );
      const taken = new Set(rows.map((r) => new Date(r.at).getTime()));
      const add = times.filter((t) => !taken.has(t.at));
      if (add.length > REPEAT_MAX) {
        throw refuse.limitExceeded(REPEAT_LIMIT_WORDS);
      }
      return { add, skipped: times.length - add.length };
    };
    const result = (
      add: { value: string }[],
      skipped: number,
      dry: boolean,
    ) => ({
      count: add.length,
      skipped,
      first: add
        .slice(0, REPEAT_FIRST)
        .map((t) => displayValue(field, t.value)),
      dry_run: dry,
    });

    if (input.dry_run) {
      const { add, skipped } = await plan(m0);
      return result(add, skipped, true);
    }
    return this.dataSource.transaction(async (m) => {
      // One repeat per list at a time, so two can't add the same times.
      await m.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `lists-repeat:${list.collection.id}`,
      ]);
      const { add, skipped } = await plan(m);
      for (const time of add) {
        await this.records.create(
          chatbot.id,
          key,
          actor,
          { ...(input.values ?? {}), [field.key]: time.value },
          { manager: m, lockMode: 'list' },
        );
      }
      return result(add, skipped, false);
    });
  }
}
