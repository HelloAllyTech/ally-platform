import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ListDefinitionsService } from '../lists/list-definitions.service';
import type { ListDefinitionView } from '../lists/list-definitions.service';
import { relationTarget } from '../lists/list-fields';
import { ListRecordsService } from '../lists/list-records.service';
import { LIST_COPY, ListRefusalException } from '../lists/list-refusals';
import type { ListActor, ListRecordView } from '../lists/list-types';
import type { ChatbotSettingsOverride } from '../type/chatbot.type';
import {
  datedLists,
  listToolDefinitions,
  offeredListTools,
  parseListToolInput,
  parseListToolName,
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
  ) {}

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
        const found = await this.records.query(
          ctx.chatbotId,
          list.key,
          actor,
          toListQuery(list, input),
          scope,
        );
        return {
          ok: true,
          result: {
            list: about,
            passages: found.records.map((r) => recordPassage(list, r)),
            total: found.total,
            ...(found.aggregate ? { aggregate: found.aggregate } : {}),
          },
        };
      }
      const data = toListData(list, input);
      let record: ListRecordView;
      if (def.kind === 'create' && dryRun && !ctx.contactId && personList) {
        record = await this.previewCreate(ctx.chatbotId, list.key, actor, data);
      } else if (def.kind === 'create') {
        ({ record } = await this.records.create(
          ctx.chatbotId,
          list.key,
          actor,
          data,
          { ...scope, dryRun },
        ));
      } else {
        const id = String(input.id ?? '');
        if (!UUID.test(id)) {
          return refused(list, lists, {
            code: 'not_found',
            message: LIST_COPY.not_found(),
          });
        }
        const current = await this.records.get(
          ctx.chatbotId,
          list.key,
          actor,
          id,
          scope,
        );
        ({ record } = await this.records.update(
          ctx.chatbotId,
          list.key,
          actor,
          id,
          data,
          current.version,
          { ...scope, dryRun },
        ));
      }
      return {
        ok: true,
        result: {
          list: about,
          passages: [recordPassage(list, record)],
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

const PREVIEW_ROLLBACK = new Error('preview: roll back');

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
