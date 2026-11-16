import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { isHealthPack } from '../../bot-draft/safety-pack/safety-packs';
import { LoggerService } from '../../logger/logger.service';
import { AiService } from '../../ai/service/ai.service';
import type {
  AgentMemoryWrite,
  AgentRunRequest,
} from '../../ai/dto/knowledge.dto';
import { WaHandledBy } from '../../whatsapp/enum/whatsapp.enum';
import { isPreviewConversation } from '../agent-tools/list-tools.service';
import type { Chatbot } from '../entity/chatbot.entity';
import { MemorySection, MemorySourceKind } from '../entity/memory-entry.entity';
import { AgentRuntimeUsed } from '../enum/chatbot.enum';
import { ChatbotSettingsService } from '../service/chatbot-settings.service';
import { renderMemory, type RenderableLine } from './memory-render';
import { memorySettingsOf } from './memory-settings';
import { matchesNeverStore, neverStoreList } from './never-store';

export { memorySettingsOf } from './memory-settings';

/** At most this many active lines per person; past it, the oldest context line goes. */
export const MAX_ACTIVE_LINES = 40;
export const MAX_LINE_CHARS = 200;
export const MAX_NAME_CHARS = 80;
/** A section's own limit in days; preferences have none (only retention). */
export const SECTION_DAYS: Record<MemorySection, number | null> = {
  [MemorySection.OPEN_ITEMS]: 30,
  [MemorySection.CONTEXT]: 180,
  [MemorySection.PREFERENCES]: null,
};
/** Replies whose run may remember: the agent's own answer, decline or clarifying question. */
const REMEMBERING_REPLIES = new Set<string>([
  WaHandledBy.RAG,
  WaHandledBy.DECLINED,
  WaHandledBy.CLARIFIED,
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_MS = 24 * 60 * 60 * 1000;
const SECTIONS = new Set<string>(Object.values(MemorySection));

/** What a run sends about the person, and the short ids it was shown. */
export interface MemoryForRun {
  fields: Pick<AgentRunRequest, 'memory' | 'summary' | 'person_name'>;
  refs: Record<string, string>;
}

/** A run's writes, kept on its decision for the step after the reply. */
export interface PendingMemory {
  writes: AgentMemoryWrite[];
  refs: Record<string, string>;
}

/** What `apply` did, for tests and the log line (counts only, never text). */
export interface MemoryApplied {
  added: number;
  renewed: number;
  replaced: number;
  done: number;
  forgotten: number;
  named: boolean;
  refused: number;
  dropped: number;
}

export interface InboxMemoryLine {
  id: string;
  section: MemorySection;
  text: string;
  saidAt: string;
  sourceKind: MemorySourceKind;
  sourceMessageId: string | null;
  sourceConversationId: string | null;
}

/** Lower-case, single spaces, no closing full stop: "Prefers evenings." is "prefers evenings". */
const sameText = (text: string): string =>
  text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!]+$/, '');

/** Rows from a RETURNING query: TypeORM's Postgres driver gives UPDATE and DELETE as [rows, count]. */
export const returned = <T>(result: unknown): T[] => {
  if (
    Array.isArray(result) &&
    result.length === 2 &&
    Array.isArray(result[0]) &&
    typeof result[1] === 'number'
  ) {
    return result[0] as T[];
  }
  return (Array.isArray(result) ? result : []) as T[];
};

const clean = (text: unknown): string =>
  typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';

/**
 * When a line said at `saidAt` expires: its section's limit, and never later than retention, since
 * nothing derived from a message outlives the message. Null: kept until said again or forgotten
 * (preferences with retention off).
 */
export function expiryFor(
  section: MemorySection,
  saidAt: Date,
  retentionDays: number | null | undefined,
): Date | null {
  const limits = [
    SECTION_DAYS[section],
    retentionDays && retentionDays > 0 ? retentionDays : null,
  ].filter((d): d is number => d !== null);
  if (!limits.length) return null;
  return new Date(saidAt.getTime() + Math.min(...limits) * DAY_MS);
}

/**
 * Memory, light (chunk 8a): what an assistant remembers about each person, kept in ally-be (never
 * in ally-ai's checkpointer) so Forget, erasure and retention cover it.
 *
 * A run asks to remember; nothing is stored until the reply has gone out, and only when the reply
 * that went out was the agent's own (never a crisis reply, Safety, a hand-over, an error or a v1
 * fallback) and never in Try it. Every line is checked here: its section, its length, the bot's
 * never-store list, that the line it changes is this person's, and on a health pack the model
 * check, which fails closed.
 */
@Injectable()
export class MemoryService {
  private readonly logger = LoggerService.getInstance(MemoryService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly ai: AiService,
    private readonly settings: ChatbotSettingsService,
  ) {}

  // ──────────────────────────────────────────────────────────── the run

  /**
   * What the run gets: the person's lines (memory on), this chat's summary and the person's name.
   * Each only when there is one; with memory off, no summary and no name, nothing, so the run is
   * today's. Never fails a run: a failed read sends nothing.
   */
  async forRun(
    chatbot: Pick<Chatbot, 'id' | 'settings' | 'safetyPack'>,
    contactId: string | null | undefined,
    conversationId: string,
    timeZone?: string,
  ): Promise<MemoryForRun> {
    const settings = memorySettingsOf(chatbot);
    const known = Boolean(contactId && UUID.test(contactId));
    try {
      const [summary, name, lines] = await Promise.all([
        UUID.test(conversationId)
          ? this.summaryOf(chatbot.id, conversationId)
          : Promise.resolve(null),
        known ? this.nameOf(chatbot.id, contactId!) : Promise.resolve(null),
        settings.on && known
          ? this.activeLines(chatbot.id, contactId!)
          : Promise.resolve([] as RenderableLine[]),
      ]);
      const rendered = renderMemory(lines, { timeZone });
      const fields: MemoryForRun['fields'] = {};
      if (settings.on) {
        fields.memory = {
          // Their name first, so "what do you know about me?" has it (chunk 8a).
          lines: [name ? `Name: ${name}` : '', rendered.text]
            .filter(Boolean)
            .join('\n'),
          never_store: neverStoreList(chatbot.safetyPack, settings.neverStore),
        };
      }
      if (summary) fields.summary = summary;
      if (name) fields.person_name = name;
      return { fields, refs: rendered.refs };
    } catch (error) {
      this.logger.warn(
        `Could not read memory for a run: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      return { fields: {}, refs: {} };
    }
  }

  private async summaryOf(
    chatbotId: string,
    conversationId: string,
  ): Promise<string | null> {
    const [row] = (await this.dataSource.query(
      `SELECT summary FROM chatbot_conversations WHERE id = $1 AND chatbot_id = $2`,
      [conversationId, chatbotId],
    )) as { summary: string | null }[];
    return row?.summary?.trim() || null;
  }

  private async nameOf(
    chatbotId: string,
    contactId: string,
  ): Promise<string | null> {
    const [row] = (await this.dataSource.query(
      `SELECT display_name FROM chatbot_contacts WHERE id = $1 AND chatbot_id = $2`,
      [contactId, chatbotId],
    )) as { display_name: string | null }[];
    return row?.display_name?.trim().slice(0, MAX_NAME_CHARS) || null;
  }

  private async activeLines(
    chatbotId: string,
    contactId: string,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<RenderableLine[]> {
    const rows = (await manager.query(
      `SELECT id, section, text, said_at FROM memory_entries
        WHERE chatbot_id = $1 AND contact_id = $2 AND status = 'active'
          AND (expires_at IS NULL OR expires_at > now())
        ORDER BY said_at DESC`,
      [chatbotId, contactId],
    )) as {
      id: string;
      section: MemorySection;
      text: string;
      said_at: Date;
    }[];
    return rows.map((r) => ({
      id: r.id,
      section: r.section,
      text: r.text,
      saidAt: new Date(r.said_at),
    }));
  }

  // ──────────────────────────────────────────────────── after the reply

  /**
   * After the reply has been sent: apply what the run asked to remember. Decided from what was
   * delivered (the stored reply for this run, its handled-by and runtime), never from the agent's
   * decision: the crisis check runs alongside the agent, and when its reply wins the agent's
   * decision can still say "answer". Never throws, and the person never waits for it.
   */
  async afterTurn(input: {
    chatbot: Pick<Chatbot, 'id' | 'settings' | 'safetyPack'>;
    conversationId: string;
    runId: string | undefined;
    pending: PendingMemory | undefined;
    repliedAt?: number;
  }): Promise<MemoryApplied | null> {
    const { chatbot, conversationId, runId, pending } = input;
    if (!pending?.writes.length || !runId) return null;
    if (isPreviewConversation(conversationId) || !UUID.test(conversationId)) {
      return null;
    }
    try {
      const sent = await this.deliveredReply(chatbot.id, conversationId, runId);
      if (!sent) return null;
      const applied = await this.apply(chatbot, {
        contactId: sent.contactId,
        conversationId,
        sourceMessageId: sent.sourceMessageId,
        runId,
        writes: pending.writes,
        refs: pending.refs,
      });
      const ms = input.repliedAt ? Date.now() - input.repliedAt : null;
      this.logger.info(
        `Memory for chatbot ${chatbot.id}: ${applied.added} added, ${applied.renewed} renewed, ` +
          `${applied.replaced} replaced, ${applied.done} done, ${applied.forgotten} forgotten, ` +
          `${applied.refused} refused, ${applied.dropped} dropped by the check` +
          (applied.named ? ', name set' : '') +
          (ms !== null ? ` (${ms} ms after the reply)` : ''),
      );
      return applied;
    } catch (error) {
      this.logger.warn(
        `Memory not applied for chatbot ${chatbot.id}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      return null;
    }
  }

  /**
   * The reply that went out for this run, if it was the agent's own: its contact, and the person
   * message it answered (which must be this contact's, in this chat).
   */
  private async deliveredReply(
    chatbotId: string,
    conversationId: string,
    runId: string,
  ): Promise<{ contactId: string; sourceMessageId: string } | null> {
    const [reply] = (await this.dataSource.query(
      `SELECT m.handled_by, m.agent_runtime, m.in_reply_to_id, m."createdAt", c.contact_id
         FROM chatbot_messages m
         JOIN chatbot_conversations c ON c.id = m.conversation_id
        WHERE m.conversation_id = $1 AND m.agent_run_id = $2 AND m.role = 'assistant'
          AND c.chatbot_id = $3 AND m.status <> 'failed'
        ORDER BY m."createdAt" DESC
        LIMIT 1`,
      [conversationId, runId, chatbotId],
    )) as {
      handled_by: string | null;
      agent_runtime: string | null;
      in_reply_to_id: string | null;
      createdAt: Date;
      contact_id: string;
    }[];
    if (
      !reply ||
      reply.agent_runtime !== AgentRuntimeUsed.V2 ||
      !REMEMBERING_REPLIES.has(reply.handled_by ?? '')
    ) {
      return null;
    }
    const [source] = (await this.dataSource.query(
      reply.in_reply_to_id
        ? `SELECT id FROM chatbot_messages
            WHERE id = $1 AND conversation_id = $2 AND role = 'user'`
        : `SELECT id FROM chatbot_messages
            WHERE conversation_id = $2 AND role = 'user' AND "createdAt" <= $1
            ORDER BY "createdAt" DESC LIMIT 1`,
      [reply.in_reply_to_id ?? reply.createdAt, conversationId],
    )) as { id: string }[];
    return source
      ? { contactId: reply.contact_id, sourceMessageId: source.id }
      : null;
  }

  /**
   * Check and store a run's writes for one contact, in one transaction. Exposed for tests; callers
   * go through `afterTurn`, which has already checked that the reply was the agent's own.
   */
  async apply(
    chatbot: Pick<Chatbot, 'id' | 'settings' | 'safetyPack'>,
    run: {
      contactId: string;
      conversationId: string;
      sourceMessageId: string;
      runId: string;
      writes: AgentMemoryWrite[];
      refs: Record<string, string>;
    },
  ): Promise<MemoryApplied> {
    const settings = memorySettingsOf(chatbot);
    const out: MemoryApplied = {
      added: 0,
      renewed: 0,
      replaced: 0,
      done: 0,
      forgotten: 0,
      named: false,
      refused: 0,
      dropped: 0,
    };
    // The source must be this contact's, in this chat, on this bot.
    const [owned] = (await this.dataSource.query(
      `SELECT 1 FROM chatbot_messages m
         JOIN chatbot_conversations c ON c.id = m.conversation_id
        WHERE m.id = $1 AND m.conversation_id = $2 AND m.role = 'user'
          AND c.contact_id = $3 AND c.chatbot_id = $4`,
      [run.sourceMessageId, run.conversationId, run.contactId, chatbot.id],
    )) as unknown[];
    if (!owned) {
      out.refused = run.writes.length;
      return out;
    }

    const refuse = (text: string) =>
      matchesNeverStore(text, chatbot.safetyPack, settings.neverStore);
    // Code checks first; then, on a health pack, the model check over every line to be written.
    const checked: AgentMemoryWrite[] = [];
    for (const write of run.writes) {
      const text = clean(write.text);
      if (write.op === 'name') {
        if (!text || text.length > MAX_NAME_CHARS || refuse(text)) {
          out.refused++;
          continue;
        }
        checked.push({ op: 'name', text });
        continue;
      }
      if (!settings.on) {
        out.refused++;
        continue;
      }
      if (write.op === 'add' || write.op === 'replace') {
        if (
          !text ||
          text.length > MAX_LINE_CHARS ||
          refuse(text) ||
          (write.op === 'add' && !SECTIONS.has(write.section ?? '')) ||
          (write.op === 'replace' && !run.refs[write.id ?? ''])
        ) {
          out.refused++;
          continue;
        }
        checked.push({ ...write, text });
        continue;
      }
      if (
        (write.op === 'done' || write.op === 'forget') &&
        run.refs[write.id ?? '']
      ) {
        checked.push(write);
        continue;
      }
      out.refused++;
    }
    const lines = checked.filter((w) => w.op === 'add' || w.op === 'replace');
    let keep = lines.map(() => true);
    if (lines.length && isHealthPack(chatbot.safetyPack)) {
      keep = await this.healthCheck(
        lines.map((w) => w.text!),
        neverStoreList(chatbot.safetyPack, settings.neverStore),
      );
    }
    const allowed = checked.filter((w) => {
      const i = lines.indexOf(w);
      if (i < 0 || keep[i]) return true;
      out.dropped++;
      return false;
    });
    if (!allowed.length) return out;

    const retentionDays = (await this.settings.get()).retentionDays;
    const now = new Date();
    await this.dataSource.transaction(async (m) => {
      // One writer per person at a time, so the limit and renewals can't race.
      const [contact] = (await m.query(
        `SELECT id, display_name FROM chatbot_contacts
          WHERE id = $1 AND chatbot_id = $2 FOR UPDATE`,
        [run.contactId, chatbot.id],
      )) as { id: string; display_name: string | null }[];
      if (!contact) return;
      for (const write of allowed) {
        if (write.op === 'name') {
          if (contact.display_name?.trim()) continue;
          await m.query(
            `UPDATE chatbot_contacts SET display_name = $3, "updatedAt" = now()
              WHERE id = $1 AND chatbot_id = $2
                AND (display_name IS NULL OR btrim(display_name) = '')`,
            [run.contactId, chatbot.id, write.text],
          );
          out.named = true;
          continue;
        }
        const lineId =
          write.op === 'add' ? undefined : run.refs[write.id ?? ''];
        // A line it changes must be this person's, on this bot, and still there.
        const target = lineId
          ? (
              (await m.query(
                `SELECT id, section FROM memory_entries
                  WHERE id = $1 AND chatbot_id = $2 AND contact_id = $3 AND status = 'active'`,
                [lineId, chatbot.id, run.contactId],
              )) as { id: string; section: MemorySection }[]
            )[0]
          : undefined;
        if (write.op !== 'add' && !target) {
          out.refused++;
          continue;
        }
        if (write.op === 'forget') {
          await m.query(`DELETE FROM memory_entries WHERE id = $1`, [
            target!.id,
          ]);
          out.forgotten++;
          continue;
        }
        if (write.op === 'done') {
          await m.query(
            `UPDATE memory_entries SET status = 'done', run_id = $2, "updatedAt" = now()
              WHERE id = $1`,
            [target!.id, run.runId],
          );
          out.done++;
          continue;
        }
        const section =
          write.op === 'replace'
            ? SECTIONS.has(write.section ?? '')
              ? (write.section as MemorySection)
              : target!.section
            : (write.section as MemorySection);
        const expires = expiryFor(section, now, retentionDays);
        if (write.op === 'replace') {
          await m.query(
            `UPDATE memory_entries
                SET text = $2, section = $3, source_message_id = $4, source_kind = 'person',
                    run_id = $5, said_at = $6, expires_at = $7, "updatedAt" = now()
              WHERE id = $1`,
            [
              target!.id,
              write.text,
              section,
              run.sourceMessageId,
              run.runId,
              now,
              expires,
            ],
          );
          out.replaced++;
          continue;
        }
        // Saying it again renews the line rather than adding a second.
        const existing = (
          (await m.query(
            `SELECT id, text FROM memory_entries
              WHERE chatbot_id = $1 AND contact_id = $2 AND section = $3 AND status = 'active'`,
            [chatbot.id, run.contactId, section],
          )) as { id: string; text: string }[]
        ).find((row) => sameText(row.text) === sameText(write.text!));
        if (existing) {
          await m.query(
            `UPDATE memory_entries
                SET source_message_id = $2, run_id = $3, said_at = $4, expires_at = $5,
                    "updatedAt" = now()
              WHERE id = $1`,
            [existing.id, run.sourceMessageId, run.runId, now, expires],
          );
          out.renewed++;
          continue;
        }
        if (!(await this.makeRoom(m, chatbot.id, run.contactId))) {
          out.refused++;
          continue;
        }
        await m.query(
          `INSERT INTO memory_entries
             (chatbot_id, contact_id, section, text, source_message_id, source_kind, run_id,
              status, said_at, expires_at)
           VALUES ($1, $2, $3, $4, $5, 'person', $6, 'active', $7, $8)`,
          [
            chatbot.id,
            run.contactId,
            section,
            write.text,
            run.sourceMessageId,
            run.runId,
            now,
            expires,
          ],
        );
        out.added++;
      }
    });
    return out;
  }

  /** Room for one more line: past 40 active, the oldest context line goes. False: no room. */
  private async makeRoom(
    m: EntityManager,
    chatbotId: string,
    contactId: string,
  ): Promise<boolean> {
    const [{ n }] = (await m.query(
      `SELECT count(*)::int AS n FROM memory_entries
        WHERE chatbot_id = $1 AND contact_id = $2 AND status = 'active'`,
      [chatbotId, contactId],
    )) as { n: number }[];
    if (n < MAX_ACTIVE_LINES) return true;
    const dropped = returned(
      await m.query(
        `DELETE FROM memory_entries WHERE id IN (
         SELECT id FROM memory_entries
          WHERE chatbot_id = $1 AND contact_id = $2 AND status = 'active' AND section = 'context'
          ORDER BY said_at ASC
          LIMIT $3)
       RETURNING id`,
        [chatbotId, contactId, n - MAX_ACTIVE_LINES + 1],
      ),
    );
    return n - dropped.length < MAX_ACTIVE_LINES;
  }

  /** The health pack's model check: one verdict per line. Fails closed: any failure keeps none. */
  private async healthCheck(
    lines: string[],
    neverStore: string[],
  ): Promise<boolean[]> {
    try {
      const prompts = await this.ai
        .getPromptOverrides(['ally_ai_memory_check'])
        .catch(() => undefined);
      const verdict = await this.ai.checkMemoryLines({
        lines,
        never_store: neverStore,
        ...(prompts ? { prompts: prompts as Record<string, unknown> } : {}),
      });
      if (
        !verdict ||
        verdict.failed ||
        !Array.isArray(verdict.keep) ||
        verdict.keep.length !== lines.length
      ) {
        return lines.map(() => false);
      }
      return verdict.keep.map((k) => k === true);
    } catch {
      return lines.map(() => false);
    }
  }

  // ─────────────────────────────────────────────────────── the Inbox

  /** What the assistant remembers about one person, for the Inbox, by section, newest first. */
  async forInbox(
    chatbot: Pick<Chatbot, 'id' | 'settings' | 'safetyPack'>,
    contactId: string,
  ): Promise<{ on: boolean; name: string | null; lines: InboxMemoryLine[] }> {
    const rows = (await this.dataSource.query(
      `SELECT e.id, e.section, e.text, e.said_at, e.source_kind, e.source_message_id,
              m.conversation_id AS source_conversation_id
         FROM memory_entries e
         LEFT JOIN chatbot_messages m ON m.id = e.source_message_id
        WHERE e.chatbot_id = $1 AND e.contact_id = $2 AND e.status = 'active'
          AND (e.expires_at IS NULL OR e.expires_at > now())
        ORDER BY e.said_at DESC`,
      [chatbot.id, contactId],
    )) as {
      id: string;
      section: MemorySection;
      text: string;
      said_at: Date;
      source_kind: MemorySourceKind;
      source_message_id: string | null;
      source_conversation_id: string | null;
    }[];
    return {
      on: memorySettingsOf(chatbot).on,
      name: await this.nameOf(chatbot.id, contactId),
      lines: rows.map((r) => ({
        id: r.id,
        section: r.section,
        text: r.text,
        saidAt: new Date(r.said_at).toISOString(),
        sourceKind: r.source_kind,
        sourceMessageId: r.source_message_id,
        sourceConversationId: r.source_conversation_id,
      })),
    };
  }

  /** Forget one line (an editor, in the Inbox): deleted now. False: not this bot's, or gone. */
  async forget(chatbotId: string, entryId: string): Promise<boolean> {
    if (!UUID.test(entryId)) return false;
    const rows = returned(
      await this.dataSource.query(
        `DELETE FROM memory_entries WHERE id = $1 AND chatbot_id = $2 RETURNING id`,
        [entryId, chatbotId],
      ),
    );
    return rows.length > 0;
  }

  /**
   * An editor's change to a line's text. It becomes the owner's line; it keeps its date and expiry,
   * and still can't hold anything on the never-store list.
   */
  async edit(
    chatbot: Pick<Chatbot, 'id' | 'settings' | 'safetyPack'>,
    entryId: string,
    text: unknown,
  ): Promise<
    | { ok: true; line: { id: string; text: string } }
    | { ok: false; reason: 'not_found' | 'invalid' | 'never_store' }
  > {
    const value = clean(text);
    if (!value || value.length > MAX_LINE_CHARS) {
      return { ok: false, reason: 'invalid' };
    }
    if (
      matchesNeverStore(
        value,
        chatbot.safetyPack,
        memorySettingsOf(chatbot).neverStore,
      )
    ) {
      return { ok: false, reason: 'never_store' };
    }
    if (!UUID.test(entryId)) return { ok: false, reason: 'not_found' };
    const [line] = returned<{ id: string; text: string }>(
      await this.dataSource.query(
        `UPDATE memory_entries SET text = $3, source_kind = 'owner', "updatedAt" = now()
          WHERE id = $1 AND chatbot_id = $2 AND status = 'active'
          RETURNING id, text`,
        [entryId, chatbot.id, value],
      ),
    );
    return line ? { ok: true, line } : { ok: false, reason: 'not_found' };
  }

  /**
   * Forget this person: every line about them, and the summaries of their chats. Their messages
   * stay (erasure is a separate step). Returns how many lines went.
   */
  async forgetPerson(chatbotId: string, contactId: string): Promise<number> {
    const rows = returned(
      await this.dataSource.query(
        `DELETE FROM memory_entries WHERE chatbot_id = $1 AND contact_id = $2 RETURNING id`,
        [chatbotId, contactId],
      ),
    );
    await this.dataSource.query(
      `UPDATE chatbot_conversations
          SET summary = NULL, metadata = metadata - 'summaryUpto', "updatedAt" = now()
        WHERE chatbot_id = $1 AND contact_id = $2
          AND (summary IS NOT NULL OR metadata ? 'summaryUpto')`,
      [chatbotId, contactId],
    );
    return rows.length;
  }

  /** Whether a contact is this bot's. */
  async contactOf(chatbotId: string, contactId: string): Promise<boolean> {
    if (!UUID.test(contactId)) return false;
    const [row] = (await this.dataSource.query(
      `SELECT 1 FROM chatbot_contacts WHERE id = $1 AND chatbot_id = $2`,
      [contactId, chatbotId],
    )) as unknown[];
    return Boolean(row);
  }
}
