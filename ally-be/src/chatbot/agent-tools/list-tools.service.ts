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
import {
  askFirstMessage,
  endsEntry,
  namesEntry,
  offerFor,
} from './list-consent';
import {
  atDefault,
  type CardHeadline,
  headlineFor,
  isRealName,
  relatedWords,
  type RelatedWords,
} from './entry-words';
import {
  bookedForField,
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
/**
 * A test chat: Try it (`preview-…`) or a checkup question (`checkup-…`, Q4 B12). Its writes are
 * tried and rolled back, and a list tied to the person is offered with a test person standing in,
 * so a checkup can take an application or a callback as Try it can, and saves nothing.
 */
export const isPreviewConversation = (conversationId: string): boolean =>
  conversationId.startsWith('preview-') ||
  conversationId.startsWith('checkup-');

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
    /** What happened, by what the list is for (Q4 G5): a callback, a registration… */
    headline: CardHeadline;
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
      const related = await this.relatedOf(
        chatbotId,
        list,
        record,
        runId,
        contactId,
      );
      return cardOf(list, record, related, 'create');
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

  /**
   * The day, time and place of the entry a record points at (Q4 G5): a registration's event, a
   * booking's slot. Read as the agent may read it; empty when there is none or it can't be read.
   */
  private async relatedOf(
    chatbotId: string,
    list: ListDefinitionView,
    record: ListRecordView,
    runId: string,
    contactId: string | null,
  ): Promise<RelatedWords> {
    const field = list.fields.find(
      (f) =>
        !f.archived_at &&
        f.type === ListFieldType.RELATION &&
        relationTarget(f) !== 'contact' &&
        typeof record.data?.[f.key] === 'string',
    );
    if (!field) return {};
    try {
      const target = await this.definitions.getList(
        chatbotId,
        relationTarget(field),
      );
      const related = await this.records.get(
        chatbotId,
        target.key,
        { kind: 'agent', runId },
        String(record.data[field.key]),
        { contactId },
      );
      return relatedWords(target, related.display ?? {});
    } catch {
      return {};
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
    // BT1: the input as sent, for a Confirm tap to replay exactly this write.
    const sent = { ...input };
    const about = { key: list.key, name: list.name };
    const personList = Boolean(list.settings?.person_field);
    // Q4 B4: in Try it, the slots this test chat has already test-booked.
    const held: ReadonlySet<string> = new Set(
      dryRun
        ? ((await this.consent?.held(ctx.chatbotId, ctx.conversationId)) ?? [])
        : [],
    );
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
          held,
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
            held,
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
            false,
            held,
          );
          if (!nearest.length) {
            nearest = await this.nearest(
              ctx.chatbotId,
              list,
              actor,
              atLeast ?? input,
              scope,
              true,
              held,
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
      // Q4 G6: the name the person gave is theirs (the contact's name), not an entry detail.
      const {
        person_name: personName,
        for_person: forPersonGiven,
        ...fields
      } = input;
      input = fields;
      // Q4 B13: the person a booking is for, when it's someone else.
      const forPerson = isRealName(String(forPersonGiven ?? ''))
        ? String(forPersonGiven).trim().slice(0, 120)
        : undefined;
      const data = toListData(list, input);
      if (def.kind === 'create') {
        // A choice left out (the service) that the assistant's last message named, exactly one of
        // the options (chunk H1): taken from there, rather than asked again.
        await this.fillNamedChoice(ctx, list, def, data);
        // Q4 B5 (BHIVE: asked for a phone number already given before the chat): an empty phone,
        // email or name detail takes the person's pre-chat answer.
        await this.fillFromIntake(ctx, list, data, personName);
        // Q4 B13: who it's for, in the list's own detail; the entry's person is who booked.
        const forField = bookedForField(list);
        if (forPerson && forField) data[forField.key] = forPerson;
      }
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
      // Q4 B4: a slot this Try it chat already test-booked is taken for a second test booking.
      const heldField = list.fields.find(
        (f) =>
          f.type === ListFieldType.RELATION &&
          relationTarget(f) !== 'contact' &&
          held.has(String(data[f.key] ?? '')),
      );
      if (dryRun && def.kind === 'create' && heldField) {
        return refused(list, lists, {
          code: 'unique_taken',
          message: LIST_COPY.unique_taken(heldField.label),
        });
      }
      // 1. The write, tried and rolled back (chunk H1 Part B): a full slot or the per-person limit
      //    is refused here, before the person is asked anything; and it is exactly what the
      //    question names.
      const intended = await this.write(ctx, def, list, actor, data, current, {
        dryRun: true,
        personList,
      });
      // 2. Consent: a yes in a later turn to the question that named exactly this entry.
      // Q4 G5: the question names the related entry's day, time and place.
      const related = await this.relatedOf(
        ctx.chatbotId,
        list,
        intended,
        ctx.runId,
        scope?.contactId ?? null,
      );
      const offer = offerFor(
        list,
        def.kind === 'create' ? 'create' : 'update',
        intended,
        current,
        booking || Boolean(related.when),
        related,
        // Q4 H7: who it's for, else the name typed in this chat, said back over the account's.
        forPerson ??
          (isRealName(String(personName ?? ''))
            ? String(personName).trim().slice(0, 120)
            : undefined),
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
        // BT1: the card a Confirm tap confirms, from the dry-run entry, and what it replays.
        const action =
          def.kind === 'create'
            ? 'create'
            : endsEntry(list, intended, current)
              ? 'cancel'
              : 'update';
        const card = {
          action,
          ...cardOf(list, intended, related, action),
        } as const;
        const asked = this.consent
          ? await this.consent.offer(
              ctx,
              def.name,
              offer.key,
              list.name,
              offer.questions,
              { input: sent, card },
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
      // 3. The write itself, unless ally-be has already stopped waiting for this run (chunk H1):
      //    its reply has gone, and a write now would be one the person was never told about.
      if (await this.consent?.ended(ctx.runId)) {
        return {
          ok: false,
          error: 'run_ended',
          result: { list: about, passages: [] },
        };
      }
      const record = await this.write(ctx, def, list, actor, data, current, {
        dryRun,
        personList,
      });
      await this.consent?.consume(ctx.chatbotId, ctx.conversationId);
      if (!dryRun && ctx.contactId && isRealName(String(personName ?? ''))) {
        // The name typed in the chat wins over the signed-in account's (Q4 H7: "I'm Priya Test"
        // was booked under the account's name). The entry, the inbox and the next chat show it.
        await this.dataSource.query(
          `UPDATE chatbot_contacts SET display_name = $3, "updatedAt" = now()
            WHERE id = $1 AND chatbot_id = $2`,
          [
            ctx.contactId,
            ctx.chatbotId,
            String(personName).trim().slice(0, 120),
          ],
        );
      }
      if (dryRun && def.kind === 'create') {
        // Q4 B4: Try it's test booking holds its slot for the rest of this test chat.
        await this.consent?.hold(
          ctx.chatbotId,
          ctx.conversationId,
          list.fields
            .filter(
              (f) =>
                f.type === ListFieldType.RELATION &&
                relationTarget(f) !== 'contact' &&
                typeof data[f.key] === 'string',
            )
            .map((f) => String(data[f.key])),
        );
      }
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
        // Q4 B8: a full or taken time with no alternatives of its own gets the nearest free ones.
        const nearby =
          !error.refusal.conflict?.alternatives?.length &&
          ['capacity_full', 'unique_taken', 'limit_exceeded'].includes(
            error.refusal.code,
          )
            ? await this.nearbyFree(ctx, list, lists, input, held)
            : null;
        return refused(list, lists, error.refusal, nearby);
      }
      throw error;
    }
  }

  /**
   * The nearest free entries to the one a refused booking asked for (Q4 B8): the related list's
   * dated entries around its time, free ones only. Null when the booking has no dated entry.
   */
  private async nearbyFree(
    ctx: AgentToolContext,
    list: ListDefinitionView,
    lists: ListDefinitionView[],
    input: Record<string, string | number>,
    held: ReadonlySet<string>,
  ): Promise<{ list: ListDefinitionView; records: ListRecordView[] } | null> {
    try {
      const field = list.fields.find(
        (f) =>
          !f.archived_at &&
          f.type === ListFieldType.RELATION &&
          relationTarget(f) !== 'contact' &&
          typeof input[f.key] === 'string',
      );
      const target =
        field && lists.find((l) => l.key === relationTarget(field));
      const dated = target?.fields.find(
        (f) => !f.archived_at && f.type === ListFieldType.DATETIME,
      );
      if (!field || !target || !dated) return null;
      const actor: ListActor = { kind: 'agent', runId: ctx.runId };
      const scope = { contactId: ctx.contactId };
      const asked = await this.records.get(
        ctx.chatbotId,
        target.key,
        actor,
        String(input[field.key]),
        scope,
      );
      const at = String(asked.data?.[dated.key] ?? '');
      if (!at) return null;
      const records = (
        await this.nearest(
          ctx.chatbotId,
          target,
          actor,
          { [`${dated.key}_at`]: at },
          scope,
          true,
          new Set([...held, asked.id]),
        )
      ).slice(0, 3);
      return records.length ? { list: target, records } : null;
    } catch {
      return null;
    }
  }

  /**
   * The person's pre-chat answers (the bot page's questions before the chat), for the details a
   * write leaves empty (Q4 B5): their phone, email and name. Never overwrites what was given.
   */
  private async fillFromIntake(
    ctx: AgentToolContext,
    list: ListDefinitionView,
    data: Record<string, unknown>,
    personName: unknown,
  ): Promise<void> {
    const empty = (key: string) =>
      data[key] === undefined || data[key] === null || data[key] === '';
    const writable = list.fields.filter(
      (f) => !f.archived_at && f.agent_write && empty(f.key),
    );
    if (!writable.length) return;
    let answers: { label: string; type: string; value: string }[] = [];
    if (ctx.contactId) {
      try {
        const [row] = (await this.dataSource.query(
          `SELECT metadata -> 'intake' -> 'answers' AS answers FROM chatbot_conversations
            WHERE chatbot_id = $1 AND contact_id = $2 AND metadata ? 'intake'
            ORDER BY "updatedAt" DESC LIMIT 1`,
          [ctx.chatbotId, ctx.contactId],
        )) as { answers: typeof answers | null }[];
        answers = row?.answers ?? [];
      } catch {
        answers = [];
      }
    }
    const answer = (type: string, label?: RegExp) =>
      answers.find(
        (a) =>
          String(a.value ?? '').trim() &&
          (a.type === type || (label ? label.test(a.label ?? '') : false)),
      )?.value;
    for (const f of writable) {
      let value: string | undefined;
      if (f.type === ListFieldType.PHONE)
        value = answer('phone', /phone|mobile/i);
      else if (f.type === ListFieldType.EMAIL)
        value = answer('email', /e-?mail/i);
      else if (
        f.type === ListFieldType.TEXT &&
        /(^|_)name$|^name|full.?name/i.test(f.key)
      ) {
        value =
          (isRealName(String(personName ?? ''))
            ? String(personName)
            : undefined) ?? answer('name', /name/i);
      }
      if (value?.trim()) data[f.key] = value.trim();
    }
  }

  private async fillNamedChoice(
    ctx: AgentToolContext,
    list: ListDefinitionView,
    def: ListToolDefinition,
    data: Record<string, unknown>,
  ): Promise<void> {
    const missing = missingChoice(list, def, data);
    if (!missing || !this.consent) return;
    const previous = (await this.consent.previousMessage(ctx.runId)) ?? '';
    const said = previous.toLowerCase();
    const named = missing.options.filter((option) =>
      said.includes(option.toLowerCase()),
    );
    if (named.length === 1) data[missing.key] = named[0];
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
  >(
    chatbotId: string,
    list: ListDefinitionView,
    found: T,
    held: ReadonlySet<string> = new Set(),
  ): Promise<T> {
    if (!found.records.length) return found;
    const taken = await this.records.takenOf(
      chatbotId,
      list.key,
      found.records.map((r) => r.id),
    );
    // Q4 B4: in Try it, the chat's own test bookings hold their slots too.
    for (const id of held) taken.add(id);
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
    held: ReadonlySet<string> = new Set(),
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
        held,
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
        // Q4 B9 (91S stored "Try it" as the person): the stand-in carries the name the person
        // gave, when the entry has one; otherwise a test name that is never said back.
        const given = Object.entries(data).find(
          ([key, value]) =>
            /(^|_)name$|^name/i.test(key) &&
            typeof value === 'string' &&
            value.trim(),
        )?.[1] as string | undefined;
        const [{ id }] = (await m.query(
          `INSERT INTO chatbot_contacts (chatbot_id, display_name) VALUES ($1, $2) RETURNING id`,
          [chatbotId, given?.trim().slice(0, 120) || 'Test visitor'],
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
/**
 * What the agent is told about a refusal (Q4 B8): plain words, and what to offer instead. Fixed
 * text, in `Q4-PROMPTS.md` for review; the owner-facing wording stays the list's own.
 */
export const AGENT_REFUSAL: Partial<Record<string, string>> = {
  unique_taken:
    'That time is no longer free. Say so plainly and offer the free times listed here, if any.',
  capacity_full:
    'That one is full. Say so plainly and offer the free times listed here, if any.',
  limit_exceeded:
    'That would go over the limit. Say so plainly and offer the free times listed here, if any.',
  limit_reached:
    'They already have as many as this list allows. Say so plainly and offer to change their existing one instead.',
  transition_not_allowed:
    "That can't be changed or cancelled here. Say so plainly, and offer to pass it to the team if one of your tools can; never say it's done.",
};

function refused(
  list: ListDefinitionView,
  lists: ListDefinitionView[],
  refusal: ListRefusalException['refusal'],
  nearby: { list: ListDefinitionView; records: ListRecordView[] } | null = null,
): AgentToolOutcome {
  const field = refusal.field
    ? list.fields.find((f) => f.key === refusal.field)
    : undefined;
  const target =
    (field && lists.find((l) => l.key === relationTarget(field))) || list;
  const alternatives: RecordPassage[] = [
    ...(refusal.conflict?.alternatives ?? []).map((r) =>
      recordPassage(target, r),
    ),
    ...(nearby?.records ?? []).map((r) => recordPassage(nearby!.list, r)),
  ];
  const next = AGENT_REFUSAL[refusal.code];
  return {
    ok: false,
    error: refusal.code,
    result: {
      message: next ? `${refusal.message} ${next}` : refusal.message,
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
    // The schema's enum carries "" for "not given": not an option to offer or match.
    const options = (property?.enum ?? []).filter((o) => o.trim());
    if (!options.length) continue;
    const given = data[f.key];
    if (given !== undefined && given !== null && given !== '') continue;
    if (f.default !== undefined && f.default !== null && f.default !== '') {
      continue;
    }
    return { key: f.key, label: f.label, options };
  }
  return null;
}

/**
 * A card for one entry (6b, Q4 G5; BT1): the entry's title (the day and time), the related
 * entry's day, time and place first, then up to four details the agent may read. Never the person
 * field, a contact, a masked value or a value left at its default ("Guests 0").
 */
export function cardOf(
  list: ListDefinitionView,
  record: ListRecordView,
  related: RelatedWords,
  action: 'create' | 'update' | 'cancel',
): {
  list: string;
  title: string;
  headline: CardHeadline;
  details: { label: string; value: string }[];
} {
  const titleKey = list.settings?.title_field;
  const fields = list.fields
    .filter(
      (f) =>
        !f.archived_at &&
        f.agent_read &&
        !f.privacy?.masked &&
        f.key !== titleKey &&
        f.key !== list.settings?.person_field &&
        !(f.type === ListFieldType.RELATION && relationTarget(f) === 'contact'),
    )
    .filter((f) => !atDefault(f, record.data?.[f.key]))
    .map((f) => ({ label: f.label, value: record.display?.[f.key] ?? '' }))
    .filter((d) => d.value !== '');
  const details = [
    ...(related.when ? [{ label: 'When', value: related.when }] : []),
    ...(related.where ? [{ label: 'Where', value: related.where }] : []),
    ...fields,
  ].slice(0, 4);
  // A booking points at another list's entry (a slot, an event); a callback or a lead doesn't.
  const booking =
    Boolean(related.when) ||
    list.fields.some(
      (f) =>
        !f.archived_at &&
        f.type === ListFieldType.RELATION &&
        relationTarget(f) !== 'contact',
    );
  return {
    list: list.name,
    title: record.title,
    headline: headlineFor(list, action, booking),
    details,
  };
}
