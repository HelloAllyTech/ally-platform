import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ListDefinitionsService } from '../lists/list-definitions.service';
import type { ListDefinitionView } from '../lists/list-definitions.service';
import { ListFieldType } from '../enum/list.enum';
import { relationTarget } from '../lists/list-fields';
import { ListRecordsService } from '../lists/list-records.service';
import { LIST_COPY, ListRefusalException } from '../lists/list-refusals';
import type { ListActor, ListRecordView } from '../lists/list-types';
import type { ChatbotSettingsOverride } from '../type/chatbot.type';
import { ListConsentService } from './list-consent.service';
import { askFirstMessage, namesEntry, offerFor } from './list-consent';
import {
  datedLists,
  listToolDefinitions,
  offeredListTools,
  parseListToolInput,
  parseListToolName,
  playbookOf,
  recordPassage,
  toListData,
  toListQuery,
  type ListToolDefinition,
  type OfferedListTools,
  type RecordPassage,
} from './list-tools';
import type {
  AgentGatewayTool,
  AgentToolContext,
  AgentToolOutcome,
} from './tools';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Preview's conversation ids: nothing it does may change an owner's list. */
export const isPreviewConversation = (conversationId: string): boolean =>
  conversationId.startsWith('preview-');

/**
 * The agent's list tools at run time (chunk 6): which a run is offered, and each call, through 5a's
 * engine with the agent as actor. A list key resolves only inside the token's bot.
 */
@Injectable()
export class ListToolsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly definitions: ListDefinitionsService,
    private readonly records: ListRecordsService,
    // Chunk H1. Always provided by the chatbot module; without it nothing is written (every
    // write asks, and no yes can be matched), so a wiring mistake fails closed.
    @Optional() private readonly consent?: ListConsentService,
  ) {}

  /**
   * A booking or change the assistant made in a reply, as its confirmation card shows it (chunk
   * 6b): read from the stored record, scoped to the person, as the agent may see it. The record's
   * title (the day and time) and up to three other details the agent may read, never the person
   * field, a contact or a masked value. Null when it isn't there or isn't theirs (Try it rolls its
   * writes back).
   */
  async confirmation(
    chatbotId: string,
    recordId: string,
    contactId: string | null,
    runId: string,
  ): Promise<{
    list: string;
    title: string;
    details: { label: string; value: string }[];
  } | null> {
    if (!UUID.test(recordId)) return null;
    const [row] = (await this.dataSource.query(
      `SELECT c.key FROM collection_records r
         JOIN collections c ON c.id = r.collection_id
        WHERE r.id = $1 AND r.chatbot_id = $2 AND r.deleted_at IS NULL`,
      [recordId, chatbotId],
    )) as { key: string }[];
    if (!row) return null;
    try {
      const list = await this.definitions.getList(chatbotId, row.key);
      const record = await this.records.get(
        chatbotId,
        list.key,
        { kind: 'agent', runId },
        recordId,
        { contactId },
      );
      const titleKey = list.settings?.title_field;
      const details = list.fields
        .filter(
          (f) =>
            !f.archived_at &&
            f.agent_read &&
            !f.privacy?.masked &&
            f.key !== titleKey &&
            f.key !== list.settings?.person_field &&
            !(
              f.type === ListFieldType.RELATION &&
              relationTarget(f) === 'contact'
            ),
        )
        .map((f) => ({ label: f.label, value: record.display?.[f.key] ?? '' }))
        .filter((d) => d.value !== '')
        .slice(0, 3);
      return { list: list.name, title: record.title, details };
    } catch (error) {
      if (
        error instanceof ListRefusalException ||
        error instanceof NotFoundException
      ) {
        return null;
      }
      throw error;
    }
  }

  /** The list tools this run gets. A bot without lists gets none, and its request is today's. */
  async offeredFor(
    chatbotId: string,
    stored: ChatbotSettingsOverride | null | undefined,
    { knowsPerson }: { knowsPerson: boolean },
  ): Promise<OfferedListTools> {
    const lists = await this.definitions.listLists(chatbotId);
    if (!lists.length) return { definitions: [], omitted: [] };
    return offeredListTools(lists, stored, { knowsPerson });
  }

  /**
   * `find_`, `create_` or `update_<key>` as a gateway tool, for a live list of this bot that
   * generates it. Anything else is undefined (the gateway's 404).
   */
  async resolve(
    chatbotId: string,
    name: string,
  ): Promise<AgentGatewayTool<Record<string, string | number>> | undefined> {
    const parsed = parseListToolName(name);
    if (!parsed) return undefined;
    const lists = await this.definitions.listLists(chatbotId);
    const list = lists.find((l) => l.key === parsed.key);
    if (!list) return undefined;
    const names = new Map(lists.map((l) => [l.key, l.name]));
    const def = listToolDefinitions(list, names, datedLists(lists)).find(
      (d) => d.name === name,
    );
    if (!def) return undefined;
    return {
      name,
      parse: (input) => parseListToolInput(def, input),
      run: (ctx, input) => this.run(ctx, def, list, lists, input),
    };
  }

  private async run(
    ctx: AgentToolContext,
    def: ListToolDefinition,
    list: ListDefinitionView,
    lists: ListDefinitionView[],
    input: Record<string, string | number>,
  ): Promise<AgentToolOutcome> {
    const actor: ListActor = { kind: 'agent', runId: ctx.runId };
    const scope = { contactId: ctx.contactId };
    const dryRun = isPreviewConversation(ctx.conversationId);
    const about = { key: list.key, name: list.name };
    const personList = Boolean(list.settings?.person_field);
    try {
      if (def.kind === 'find') {
        let found = await this.freeOnly(
          ctx.chatbotId,
          list,
          await this.records.query(
            ctx.chatbotId,
            list.key,
            actor,
            toListQuery(list, input),
            scope,
          ),
        );
        // A number with an upper bound ("seats 2 to 2") found nothing: read it as "at
        // least" (chunk 8a), since a table for 3 seats 2. Only when something comes back.
        const atLeast = withoutUpperBounds(list, input);
        if (found.total === 0 && !found.aggregate && atLeast) {
          const roomier = await this.freeOnly(
            ctx.chatbotId,
            list,
            await this.records.query(
              ctx.chatbotId,
              list.key,
              actor,
              toListQuery(list, atLeast),
              scope,
            ),
          );
          if (roomier.total > 0) found = roomier;
        }
        // Nothing at the time asked for (chunk 8a): the nearest times there are, so the agent
        // offers them instead of passing the booking to the team.
        // When nothing near then fits the other details either (a party of 5, every table
        // seating 3), the nearest at that time without them, so the agent can say why.
        let nearest: ListRecordView[] = [];
        let loosened = false;
        if (found.total === 0 && !found.aggregate) {
          nearest = await this.nearest(
            ctx.chatbotId,
            list,
            actor,
            atLeast ?? input,
            scope,
          );
          if (!nearest.length) {
            nearest = await this.nearest(
              ctx.chatbotId,
              list,
              actor,
              atLeast ?? input,
              scope,
              true,
            );
            loosened = nearest.length > 0;
          }
        }
        return {
          ok: true,
          result: {
            list: about,
            passages: (nearest.length ? nearest : found.records).map((r) =>
              recordPassage(list, r),
            ),
            total: found.total,
            ...(nearest.length
              ? { nearest: loosened ? 'other_details' : true }
              : {}),
            ...(found.aggregate ? { aggregate: found.aggregate } : {}),
          },
        };
      }
      const data = toListData(list, input);
      const booking =
        def.kind === 'create' && playbookOf(list, [def]) === 'booking';
      // A booking needs its service (chunk H1 Part D): an empty choice the list offers is asked
      // for, never saved blank.
      const missing = booking ? missingChoice(list, def, data) : null;
      if (missing) {
        return {
          ok: false,
          error: 'missing_detail',
          result: {
            list: about,
            field: missing.key,
            message: LIST_COPY.missing_choice(missing.label, missing.options),
            passages: [],
          },
        };
      }
      let current: ListRecordView | null = null;
      if (def.kind === 'update') {
        const id = String(input.id ?? '');
        if (!UUID.test(id)) {
          return refused(list, lists, {
            code: 'not_found',
            message: LIST_COPY.not_found(),
          });
        }
        current = await this.records.get(
          ctx.chatbotId,
          list.key,
          actor,
          id,
          scope,
        );
      }
      // 1. The write, tried and rolled back (chunk H1 Part B): a full slot or the per-person limit
      //    is refused here, before the person is asked anything; and it is exactly what the
      //    question names.
      const intended = await this.write(ctx, def, list, actor, data, current, {
        dryRun: true,
        personList,
      });
      // 2. Consent: a yes in a later turn to the question that named exactly this entry.
      const offer = offerFor(
        list,
        def.kind === 'create' ? 'create' : 'update',
        intended,
        current,
        booking,
      );
      const accepted = this.consent
        ? await this.consent.accepts(
            ctx,
            def.name,
            offer.key,
            (message) =>
              namesEntry(message, list, intended) &&
              (!current || namesEntry(message, list, current)),
          )
        : null;
      if (!accepted) {
        const asked = this.consent
          ? await this.consent.offer(
              ctx,
              def.name,
              offer.key,
              list.name,
              offer.questions,
            )
          : { questions: offer.questions };
        return {
          ok: false,
          error: 'needs_confirmation',
          result: {
            list: about,
            question: asked.questions.en,
            questions: asked.questions,
            message: askFirstMessage(asked.questions.en),
            // Not the dry-run record: its "booked" would read as done.
            passages: [],
          },
        };
      }
      // 3. The write itself.
      const record = await this.write(ctx, def, list, actor, data, current, {
        dryRun,
        personList,
      });
      await this.consent?.consume(ctx.chatbotId, ctx.conversationId);
      return {
        ok: true,
        result: {
          list: about,
          passages: [recordPassage(list, record)],
          ...(current ? { before: recordPassage(list, current) } : {}),
          consent: { offered_in: accepted.runId },
          ...(dryRun ? { preview: true } : {}),
        },
      };
    } catch (error) {
      if (error instanceof ListRefusalException) {
        return refused(list, lists, error.refusal);
      }
      throw error;
    }
  }
  /**
   * One create or update through 5a's engine: tried and rolled back with `dryRun`, for real
   * otherwise. Preview's create on a person's list with no person goes through `previewCreate`.
   */
  private async write(
    ctx: AgentToolContext,
    def: ListToolDefinition,
    list: ListDefinitionView,
    actor: ListActor,
    data: Record<string, unknown>,
    current: ListRecordView | null,
    opts: { dryRun: boolean; personList: boolean },
  ): Promise<ListRecordView> {
    const scope = { contactId: ctx.contactId };
    if (def.kind === 'create') {
      if (opts.dryRun && !ctx.contactId && opts.personList) {
        return this.previewCreate(ctx.chatbotId, list.key, actor, data);
      }
      return (
        await this.records.create(ctx.chatbotId, list.key, actor, data, {
          ...scope,
          dryRun: opts.dryRun,
        })
      ).record;
    }
    return (
      await this.records.update(
        ctx.chatbotId,
        list.key,
        actor,
        current!.id,
        data,
        current!.version,
        { ...scope, dryRun: opts.dryRun },
      )
    ).record;
  }

  /**
   * Only the entries still free (Q3-fast Part 0b, C19): on a list that others book into (Slots,
   * Tables, Classes), an entry whose live bookings already fill it under the booking list's rules
   * is left out, so "which tables are free?" never offers a taken one. Any other list is unchanged.
   * A total that counted the taken entries drops by as many.
   */
  private async freeOnly<
    T extends { records: ListRecordView[]; total: number },
  >(chatbotId: string, list: ListDefinitionView, found: T): Promise<T> {
    if (!found.records.length) return found;
    const taken = await this.records.takenOf(
      chatbotId,
      list.key,
      found.records.map((r) => r.id),
    );
    if (!taken.size) return found;
    const records = found.records.filter((r) => !taken.has(r.id));
    return {
      ...found,
      records,
      total: Math.max(found.total - (found.records.length - records.length), 0),
    };
  }

  /**
   * The entries nearest a time asked for, when none matches it exactly (chunk 8a). Only for a
   * find with a time (`starts_at_at`, `_from` or `_to` on a date-and-time detail). The other
   * filters stay (open, seats) except text matches ("window" may be no table's name). It looks
   * from 12 hours before (never before now) to 7 days after, and keeps the 3 closest, in order.
   */
  private async nearest(
    chatbotId: string,
    list: ListDefinitionView,
    actor: ListActor,
    input: Record<string, string | number>,
    scope: { contactId: string | null },
    /** Only the time: the other details left out, open kept (chunk 8a). */
    timeOnly = false,
  ): Promise<ListRecordView[]> {
    const field = list.fields.find(
      (f) =>
        !f.archived_at &&
        f.type === ListFieldType.DATETIME &&
        ['at', 'from', 'to'].some(
          (op) => input[`${f.key}_${op}`] !== undefined,
        ),
    );
    if (!field) return [];
    const asked = Date.parse(
      String(
        input[`${field.key}_at`] ??
          input[`${field.key}_from`] ??
          input[`${field.key}_to`],
      ),
    );
    if (Number.isNaN(asked)) return [];
    const HOUR = 3_600_000;
    const from = new Date(Math.max(Date.now(), asked - 12 * HOUR));
    const to = new Date(asked + 7 * 24 * HOUR);
    if (from >= to) return [];
    const rest = Object.fromEntries(
      Object.entries(input).filter(
        ([k]) =>
          !k.endsWith('_contains') &&
          !k.startsWith(`${field.key}_`) &&
          (!timeOnly || k === 'open') &&
          k !== 'limit' &&
          k !== 'sort',
      ),
    );
    const query = toListQuery(list, {
      ...rest,
      [`${field.key}_from`]: from.toISOString(),
      [`${field.key}_to`]: to.toISOString(),
      sort: field.key,
      limit: NEAREST_LOOK,
    });
    try {
      const { records } = await this.freeOnly(
        chatbotId,
        list,
        await this.records.query(chatbotId, list.key, actor, query, scope),
      );
      const at = (r: ListRecordView) => Date.parse(String(r.data[field.key]));
      const timed = records.filter((r) => !Number.isNaN(at(r)));
      const byNearness = [...timed].sort(
        (a, b) => Math.abs(at(a) - asked) - Math.abs(at(b) - asked),
      );
      const picked = nearestForWindow(
        timed,
        at,
        asked,
        Date.parse(String(input[`${field.key}_to`] ?? '')),
      );
      for (const r of byNearness) {
        if (picked.length >= NEAREST_MAX) break;
        if (!picked.includes(r)) picked.push(r);
      }
      return picked.slice(0, NEAREST_MAX).sort((a, b) => at(a) - at(b));
    } catch {
      return [];
    }
  }

  /**
   * Preview knows no person, but Try it must still show what a booking would do (chunk 6): a
   * stand-in contact is made inside a transaction, the record is created for them with every rule
   * checked, and the whole transaction is rolled back. Nothing is saved, not even the stand-in.
   */
  private async previewCreate(
    chatbotId: string,
    listKey: string,
    actor: ListActor,
    data: Record<string, unknown>,
  ): Promise<ListRecordView> {
    let record: ListRecordView | undefined;
    try {
      await this.dataSource.transaction(async (m) => {
        const [{ id }] = (await m.query(
          `INSERT INTO chatbot_contacts (chatbot_id, display_name) VALUES ($1, 'Try it') RETURNING id`,
          [chatbotId],
        )) as { id: string }[];
        ({ record } = await this.records.create(
          chatbotId,
          listKey,
          actor,
          data,
          {
            contactId: id,
            manager: m,
            dryRun: true,
          },
        ));
        throw PREVIEW_ROLLBACK;
      });
    } catch (error) {
      if (error !== PREVIEW_ROLLBACK) throw error;
    }
    return record as ListRecordView;
  }
}

/**
 * The find's input with the upper bound of each number detail that also has a lower
 * one dropped ("seats_from 2, seats_to 2" → "seats_from 2"), or null when there's none.
 */
export function withoutUpperBounds(
  list: ListDefinitionView,
  input: Record<string, string | number>,
): Record<string, string | number> | null {
  const drop = list.fields
    .filter(
      (f) =>
        !f.archived_at &&
        f.type === ListFieldType.NUMBER &&
        input[`${f.key}_to`] !== undefined &&
        input[`${f.key}_from`] !== undefined,
    )
    .map((f) => `${f.key}_to`);
  if (!drop.length) return null;
  return Object.fromEntries(
    Object.entries(input).filter(([k]) => !drop.includes(k)),
  );
}

const PREVIEW_ROLLBACK = new Error('preview: roll back');
/** How many entries the nearest look reads, and how many it offers. */
const NEAREST_LOOK = 50;
const NEAREST_MAX = 3;
const DAY_MS = 24 * 3_600_000;

/**
 * When the person asked for a stretch of time ("Thursday evening": from 17:00 to 23:59) and it has
 * nothing (chunk 6b, item 1): the latest entry before it on that day, then the first entries in the
 * same stretch on the days after ("Friday has 18:00 and 19:00"). The rest of the three are filled
 * by nearness. A single time asked ("at 11") is left to nearness alone.
 */
export function nearestForWindow<T>(
  records: T[],
  at: (r: T) => number,
  from: number,
  to: number,
): T[] {
  if (Number.isNaN(to) || to <= from || to - from >= DAY_MS) return [];
  const ordered = [...records].sort((a, b) => at(a) - at(b));
  const picked: T[] = [];
  const latestBefore = [...ordered]
    .reverse()
    .find((r) => at(r) < from && from - at(r) < 12 * 3_600_000);
  if (latestBefore) picked.push(latestBefore);
  const sameStretchLater = ordered.filter((r) => {
    const days = Math.floor((at(r) - from) / DAY_MS);
    return days >= 1 && at(r) - days * DAY_MS <= to;
  });
  // The first day after that has something in the stretch: up to two of its times.
  if (sameStretchLater.length) {
    const firstDay = Math.floor((at(sameStretchLater[0]) - from) / DAY_MS);
    picked.push(
      ...sameStretchLater
        .filter((r) => Math.floor((at(r) - from) / DAY_MS) === firstDay)
        .slice(0, NEAREST_MAX - picked.length),
    );
  }
  return picked;
}

/**
 * A refusal the agent reads: the code (stored as the run's error code), §26's message, and any
 * alternatives as passages of the list they come from.
 */
function refused(
  list: ListDefinitionView,
  lists: ListDefinitionView[],
  refusal: ListRefusalException['refusal'],
): AgentToolOutcome {
  const field = refusal.field
    ? list.fields.find((f) => f.key === refusal.field)
    : undefined;
  const target =
    (field && lists.find((l) => l.key === relationTarget(field))) || list;
  const alternatives: RecordPassage[] = (
    refusal.conflict?.alternatives ?? []
  ).map((r) => recordPassage(target, r));
  return {
    ok: false,
    error: refusal.code,
    result: {
      message: refusal.message,
      ...(refusal.field ? { field: refusal.field } : {}),
      passages: alternatives,
    },
  };
}

/**
 * A booking's choice the list offers (the service) that the call left empty and the list doesn't
 * fill in itself (chunk H1 Part D): asked for, never saved blank. The status is the list's own.
 */
export function missingChoice(
  list: ListDefinitionView,
  def: ListToolDefinition,
  data: Record<string, unknown>,
): { key: string; label: string; options: string[] } | null {
  for (const f of list.fields) {
    if (f.archived_at || f.type !== ListFieldType.SELECT) continue;
    if (f.key === 'status' || f.key === list.settings?.person_field) continue;
    const property = def.input_schema.properties[f.key];
    if (!property?.enum?.length) continue;
    const given = data[f.key];
    if (given !== undefined && given !== null && given !== '') continue;
    if (f.default !== undefined && f.default !== null && f.default !== '') {
      continue;
    }
    return { key: f.key, label: f.label, options: property.enum };
  }
  return null;
}
