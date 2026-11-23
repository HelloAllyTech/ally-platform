import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { LoggerService } from '../../logger/logger.service';
import { AlertOutboxService } from '../safety/alert-outbox.service';
import { affectedOf } from '../privacy/erased';

/** The copy's state row: set once every chatbot has its copies (the migration script). */
export const QUICK_REPLY_COPY_STATE = 'quick_reply_copy';

export interface QuickReplyCopyReport {
  dryRun: boolean;
  chatbots: number;
  /** Rows copied (or that would be). */
  copied: number;
  /** Existing customisations of a mandatory reply now locked. */
  locked: number;
}

export interface QuickReplyPushResult {
  globalId: string;
  /** Locked copies whose wording was replaced. */
  copies: number;
  chatbots: number;
  noticesQueued: number;
}

/**
 * Per-chatbot quick replies (D6). Every active global reply is copied into each chatbot as its
 * own row (an override of the global, so it keeps the global's kind and place in the matching
 * order). Copies of mandatory replies (crisis, STOP, START, the consent notice) are locked: the
 * builder can add regional numbers but not change the wording, and Ally staff push a wording
 * change to every copy. A customisation a builder made before keeps its wording, now locked.
 */
@Injectable()
export class QuickReplyCopyService {
  private readonly logger = LoggerService.getInstance(
    QuickReplyCopyService.name,
  );

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Optional() private readonly outbox?: AlertOutboxService,
  ) {}

  /** Copy every active global the chatbot has no copy of yet. Idempotent. */
  async copyGlobalsInto(
    chatbotId: string,
    options: { dryRun?: boolean; manager?: EntityManager } = {},
  ): Promise<{ copied: number; locked: number }> {
    const m = options.manager ?? this.dataSource.manager;
    const missing = `FROM wa_keyword_templates g
      WHERE g.chatbot_id IS NULL AND g.archived_at IS NULL AND g.active = true
        AND NOT EXISTS (SELECT 1 FROM wa_keyword_templates o
                         WHERE o.chatbot_id = $1 AND o.overrides_template_id = g.id
                           AND o.archived_at IS NULL)`;
    const relock = `FROM wa_keyword_templates o JOIN wa_keyword_templates g ON g.id = o.overrides_template_id
      WHERE o.chatbot_id = $1 AND o.archived_at IS NULL AND g.mandatory = true AND o.locked = false`;
    if (options.dryRun) {
      const [row] = (await m.query(
        `SELECT (SELECT count(*)::int ${missing}) AS copied, (SELECT count(*)::int ${relock}) AS locked`,
        [chatbotId],
      )) as { copied: number; locked: number }[];
      return {
        copied: Number(row?.copied ?? 0),
        locked: Number(row?.locked ?? 0),
      };
    }
    const copied = affectedOf(
      await m.query(
        `INSERT INTO wa_keyword_templates
           (kind, name, match_type, patterns, language_code, priority, response_text, bypass_rag,
            terminal, active, mandatory, chatbot_id, overrides_template_id, locked, extra_numbers)
         SELECT g.kind, g.name, g.match_type, g.patterns, g.language_code, g.priority, g.response_text,
                g.bypass_rag, g.terminal, true, false, $1, g.id, g.mandatory, '{}'
         ${missing}
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [chatbotId],
      ),
    );
    const locked = affectedOf(
      await m.query(
        `UPDATE wa_keyword_templates SET locked = true, "updatedAt" = now()
          WHERE id IN (SELECT o.id ${relock})`,
        [chatbotId],
      ),
    );
    return { copied, locked };
  }

  /** Every chatbot (archived ones too). Marks the copy done when not a dry run. */
  async copyAll(
    options: { dryRun?: boolean } = {},
  ): Promise<QuickReplyCopyReport> {
    const bots = (await this.dataSource.query(
      `SELECT id FROM chatbots ORDER BY "createdAt"`,
    )) as { id: string }[];
    const report: QuickReplyCopyReport = {
      dryRun: Boolean(options.dryRun),
      chatbots: bots.length,
      copied: 0,
      locked: 0,
    };
    for (const bot of bots) {
      const r = await this.copyGlobalsInto(bot.id, { dryRun: options.dryRun });
      report.copied += r.copied;
      report.locked += r.locked;
    }
    if (!options.dryRun) {
      await this.dataSource.query(
        `INSERT INTO global_settings (name, value, "createdBy", "updatedBy")
         VALUES ($1, $2::jsonb, 0, 0)
         ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value, "updatedAt" = now()`,
        [
          QUICK_REPLY_COPY_STATE,
          JSON.stringify({
            doneAt: new Date().toISOString(),
            copied: report.copied,
          }),
        ],
      );
    }
    return report;
  }

  /**
   * Staff push: change a global reply's wording and every locked copy of it, and tell each
   * chatbot's owners. Unlocked copies (optional replies a builder reworded) keep their wording.
   */
  async pushLocked(
    globalId: string,
    change: { responseText?: string; patterns?: string[]; name?: string },
    userId: number | null,
  ): Promise<QuickReplyPushResult> {
    const [global] = (await this.dataSource.query(
      `SELECT id, name FROM wa_keyword_templates WHERE id = $1 AND chatbot_id IS NULL AND archived_at IS NULL`,
      [globalId],
    )) as { id: string; name: string }[];
    if (!global) throw new NotFoundException(`Reply ${globalId} was not found`);
    const sets: string[] = [];
    const params: unknown[] = [globalId];
    if (change.responseText?.trim()) {
      params.push(change.responseText.trim());
      sets.push(`response_text = $${params.length}`);
    }
    if (change.patterns?.length) {
      params.push(change.patterns);
      sets.push(`patterns = $${params.length}::text[]`);
    }
    if (change.name?.trim()) {
      params.push(change.name.trim());
      sets.push(`name = $${params.length}`);
    }
    params.push(userId);
    const by = `updated_by = $${params.length}`;
    const result: QuickReplyPushResult = {
      globalId,
      copies: 0,
      chatbots: 0,
      noticesQueued: 0,
    };
    if (!sets.length) return result;
    let chatbotIds: string[] = [];
    await this.dataSource.transaction(async (m) => {
      await m.query(
        `UPDATE wa_keyword_templates SET ${sets.join(', ')}, ${by}, "updatedAt" = now() WHERE id = $1`,
        params,
      );
      const rows = (await m.query(
        `UPDATE wa_keyword_templates SET ${sets.join(', ')}, ${by}, "updatedAt" = now()
          WHERE overrides_template_id = $1 AND locked = true AND archived_at IS NULL
          RETURNING chatbot_id`,
        params,
      )) as unknown;
      const list = (
        Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : rows
      ) as {
        chatbot_id: string;
      }[];
      result.copies = list.length;
      chatbotIds = [...new Set(list.map((r) => r.chatbot_id))];
    });
    result.chatbots = chatbotIds.length;
    result.noticesQueued = await this.noticeOwners(chatbotIds, global.name);
    this.logger.info(
      `Quick reply ${globalId} pushed to ${result.copies} copies on ${result.chatbots} chatbots`,
    );
    return result;
  }

  private async noticeOwners(
    chatbotIds: string[],
    replyName: string,
  ): Promise<number> {
    if (!this.outbox || !chatbotIds.length) return 0;
    const rows = (await this.dataSource.query(
      `SELECT DISTINCT m.chatbot_id, b.name, u.email FROM chatbot_members m
         JOIN chatbots b ON b.id = m.chatbot_id JOIN users u ON u.id = m.user_id
        WHERE m.chatbot_id = ANY($1::uuid[]) AND u.email IS NOT NULL
          AND (m.role = 'owner' OR 'owner' = ANY(m.roles))`,
      [chatbotIds],
    )) as { chatbot_id: string; name: string; email: string }[];
    let queued = 0;
    const stamp = Date.now();
    for (const r of rows) {
      const added = await this.outbox.enqueue({
        chatbotId: r.chatbot_id,
        kind: 'quick_reply_push',
        recipient: r.email,
        channel: 'email',
        payload: {
          // COPY: needs approval
          subject: `Ally updated a safety reply on ${r.name}`,
          // COPY: needs approval
          body: `Ally updated the wording of the fixed reply "${replyName}" on ${r.name}. Regional numbers you added are kept. You do not need to do anything.`,
        },
        dedupeKey: `qr-push:${stamp}:${r.email}`,
      });
      if (added) queued += 1;
    }
    return queued;
  }
}

/** The helpline numbers a locked reply sends: the chatbot's own, then the row's regional ones. */
export function helplineNumbersWithExtras(
  numbers: string | null | undefined,
  extraNumbers: string[] | null | undefined,
): string {
  return [numbers?.trim(), ...(extraNumbers ?? []).map((n) => n.trim())]
    .filter((n): n is string => Boolean(n))
    .join(', ');
}
