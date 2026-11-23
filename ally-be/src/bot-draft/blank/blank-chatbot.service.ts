import { ForbiddenException, Injectable, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ExecutionManager } from '../../common/execution/execution-manager';
import { LoggerService } from '../../logger/logger.service';
import { scheduledTaskRegistry } from '../../scheduler/registry/scheduled-task.registry';
import { BotDraftEntity } from '../entity/bot-draft.entity';
import { BotDraftService } from '../service/bot-draft.service';

/**
 * Blank chatbots (stage 3, "Create and Build"): a chatbot is created at the click, before anything
 * is chosen, so the split view opens at once with a test chatbot on the right.
 */
export const BLANK_LIMITS = {
  /** The most untouched blanks one builder holds; Create reuses the newest before this. */
  perBuilder: 3,
  /** An untouched blank older than this is deleted by the cleanup. */
  maxAgeHours: 24,
  /** How many the cleanup deletes per run. */
  batch: 200,
} as const;

/** The placeholder name a blank starts with (the starter bot treats it as "no name yet"). */
export const BLANK_NAME = 'Your assistant';

/**
 * The cleanup can be switched off without a deploy (build rules: kill switch per risky feature).
 * Read lazily so a test can flip it.
 */
export const blankCleanupEnabled = (): boolean =>
  (process.env.BOT_DRAFT_BLANK_CLEANUP_ENABLED ?? 'true').toLowerCase() !==
  'false';

/**
 * The candidates the cleanup may delete: untouched blanks past the age limit with nothing worth
 * keeping. "Untouched" is the explicit null `touched_at`; each other condition is checked again
 * here in case something was written without touching (belt and braces): a source (a document on or
 * owned by the chatbot, a website, a crawl), an edit (any event), a test message, a member other than
 * the creator, a template, a chatbot that went live. A budget is checked separately when the
 * budgets table exists (stage 6).
 */
const CANDIDATES_SQL = `
  SELECT d.id, d.chatbot_id
    FROM bot_drafts d
    JOIN chatbots c ON c.id = d.chatbot_id
   WHERE d.blank = true
     AND d.touched_at IS NULL
     AND d."createdAt" < now() - ($1 || ' hours')::interval
     AND c.status = 'draft'
     AND c.last_tested_at IS NULL
     AND d.live_at IS NULL
     AND jsonb_array_length(COALESCE(d.events, '[]'::jsonb)) = 0
     AND COALESCE(d.crawl->>'status', 'idle') <> 'running'
     AND COALESCE(d.source->>'website', '') = ''
     AND jsonb_array_length(COALESCE(d.draft_config->'knowledgeDocumentIds', '[]'::jsonb)) = 0
     AND NOT EXISTS (SELECT 1 FROM chatbot_documents cd WHERE cd.chatbot_id = c.id)
     AND NOT EXISTS (SELECT 1 FROM kb_documents k WHERE k.owner_chatbot_id = c.id)
     AND NOT EXISTS (SELECT 1 FROM chatbot_members m WHERE m.chatbot_id = c.id AND m.user_id <> c.created_by)
     AND NOT EXISTS (SELECT 1 FROM chatbot_template_installs t WHERE t.chatbot_id = c.id)
   ORDER BY d."createdAt"
   LIMIT $2`;

@Injectable()
export class BlankChatbotService implements OnModuleInit {
  private readonly logger = LoggerService.getInstance(BlankChatbotService.name);

  constructor(
    private readonly drafts: BotDraftService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  onModuleInit(): void {
    scheduledTaskRegistry.register(
      'hourly',
      'bot-draft-blank-cleanup',
      async () => {
        await this.cleanup();
      },
    );
  }

  /**
   * `POST /v1/bot-drafts` with no input. Idempotent per builder: the newest untouched blank is
   * returned when there is one, so a double click (or two tabs) makes one blank. Serialised per
   * builder by a transaction-scoped advisory lock, so two clicks at once can't both create.
   */
  async createOrReuse(): Promise<{ draft: BotDraftEntity; reused: boolean }> {
    const userId = Number(ExecutionManager.getUserId() ?? 0);
    if (!userId) throw new ForbiddenException('Sign in first.');
    return this.dataSource.transaction(async (manager) => {
      await manager.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
        `bot-draft-blank:${userId}`,
      ]);
      const existing: { id: string; count: string }[] = await manager.query(
        `SELECT d.id, count(*) OVER () AS count
           FROM bot_drafts d
           JOIN chatbots c ON c.id = d.chatbot_id
          WHERE d.owner_user_id = $1 AND d.blank = true AND d.touched_at IS NULL
            AND d.status = 'active' AND c.archived_at IS NULL
          ORDER BY d."createdAt" DESC
          LIMIT 1`,
        [userId],
      );
      if (existing[0]) {
        const draft = await this.drafts.findById(existing[0].id);
        if (draft) return { draft, reused: true };
      }
      // The cap is a backstop: with reuse above a builder normally holds one untouched blank.
      if (Number(existing[0]?.count ?? 0) >= BLANK_LIMITS.perBuilder) {
        throw new ForbiddenException({
          errorCode: 'too_many_blanks',
          message: 'Finish or remove one of your new assistants first.',
        });
      }
      const draft = await this.drafts.create({ name: BLANK_NAME, blank: true });
      return { draft, reused: false };
    });
  }

  /**
   * The hourly cleanup: delete untouched blanks older than a day with nothing worth keeping. The
   * draft goes first, then the chatbot; nothing shared is deleted (a chatbot with any document is
   * never a candidate, and `kb_documents` refuses the delete if one appeared), and usage rows are
   * kept (they reference the chatbot by id, without a foreign key). Each deletion re-checks its
   * candidate under a row lock, so a blank touched mid-run is kept.
   */
  async cleanup(): Promise<{ deleted: number }> {
    if (!blankCleanupEnabled()) return { deleted: 0 };
    let budgets = false;
    try {
      const [row] = await this.dataSource.query(
        `SELECT to_regclass('public.chatbot_budgets') IS NOT NULL AS present`,
      );
      budgets = Boolean(row?.present);
    } catch {
      return { deleted: 0 };
    }
    const candidates: { id: string; chatbot_id: string }[] =
      await this.dataSource.query(CANDIDATES_SQL, [
        String(BLANK_LIMITS.maxAgeHours),
        BLANK_LIMITS.batch,
      ]);
    let deleted = 0;
    for (const candidate of candidates) {
      try {
        const done = await this.dataSource.transaction(async (manager) => {
          const [locked] = await manager.query(
            `SELECT id FROM bot_drafts
              WHERE id = $1 AND blank = true AND touched_at IS NULL
              FOR UPDATE SKIP LOCKED`,
            [candidate.id],
          );
          if (!locked) return false;
          const [still] = await manager.query(
            `SELECT 1 FROM (${CANDIDATES_SQL}) x WHERE x.id = $3`,
            [
              String(BLANK_LIMITS.maxAgeHours),
              BLANK_LIMITS.batch,
              candidate.id,
            ],
          );
          if (!still) return false;
          if (budgets) {
            // A budget set aside for it (stage 6) keeps it. Any doubt keeps it too.
            const [budget] = await manager.query(
              `SELECT 1 FROM chatbot_budgets WHERE chatbot_id = $1 LIMIT 1`,
              [candidate.chatbot_id],
            );
            if (budget) return false;
          }
          await manager.query(`DELETE FROM bot_drafts WHERE id = $1`, [
            candidate.id,
          ]);
          await manager.query(
            `DELETE FROM chatbots WHERE id = $1 AND status = 'draft'`,
            [candidate.chatbot_id],
          );
          return true;
        });
        if (done) deleted += 1;
      } catch (error) {
        // One blank that can't be deleted (a budget table of another shape, a late document) is
        // kept and logged; the rest carry on.
        this.logger.warn(
          `Blank ${candidate.id} kept: ${error instanceof Error ? error.message : 'unknown'}`,
        );
      }
    }
    if (deleted)
      this.logger.info(`Deleted ${deleted} untouched blank chatbots`);
    return { deleted };
  }
}
