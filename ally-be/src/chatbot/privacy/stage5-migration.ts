import type { DataSource } from 'typeorm';
import { backfillOwners } from '../access/backfill-owners';
import { MIGRATION_COPY_TAG } from '../../knowledge-base/constants/migration-copy';
import { QuickReplyCopyService } from '../quick-replies/quick-reply-copy.service';
import { SAFETY_DEFAULTS } from '../safety/safety-settings';
import { copyDocumentsTx, CopyJob } from '../sharing/chatbot-sharing.service';
import { affectedOf } from './erased';

/**
 * Assistants stage 5: the data migration (copy, not share; per-chatbot quick replies; parking;
 * defaults; owners). Idempotent: every step touches only rows it has not handled yet, so a second
 * run reports zeros. A dry run counts and writes nothing.
 *
 * Rollback, per step (none of it is automatic):
 * 1. documents: re-attach each original and archive its copies:
 *      INSERT INTO chatbot_documents (chatbot_id, document_id)
 *        SELECT owner_chatbot_id, copied_from_document_id FROM kb_documents
 *         WHERE 'ally-migration-copy' = ANY(tags) ON CONFLICT DO NOTHING;
 *      UPDATE kb_documents SET archived_at = now() WHERE 'ally-migration-copy' = ANY(tags);
 *    (their vectors go on the next re-index of the archive; the originals were never touched).
 * 2. quick replies: DELETE FROM global_settings WHERE name = 'quick_reply_copy' (globals resolve
 *    again at once); the copies can stay (they mirror the globals) or be archived by createdAt.
 * 3. parking: UPDATE connectors SET parked = false; UPDATE wa_conversations SET parked = false.
 * 4. defaults: the values written equal the code defaults, so leaving them is harmless; to undo,
 *    UPDATE chatbots SET settings = settings - 'retentionDays' - 'audienceAge' for the ids listed.
 * 5. owners: DELETE the chatbot_members rows listed in the report (they were creator-as-owner).
 */
export interface Stage5MigrationReport {
  dryRun: boolean;
  documents: { attachments: number; copied: number; queued: number };
  quickReplies: { chatbots: number; copied: number; locked: number };
  parked: { connectors: number; waConversations: number };
  defaults: { chatbots: number };
  owners: { assigned: number; needsOwner: string[] };
}

export interface Stage5MigrationOptions {
  dryRun: boolean;
  /** Also copy shared documents attached to a single chatbot (default: only those on several). */
  allShared?: boolean;
  /** Queue one copy's indexing; absent: the copies stay `pending` for a later requeue. */
  enqueue?: (job: {
    documentId: string;
    action: 'ingest' | 'reindex';
  }) => Promise<void>;
}

export async function runStage5Migration(
  dataSource: DataSource,
  options: Stage5MigrationOptions,
): Promise<Stage5MigrationReport> {
  const { dryRun } = options;
  const report: Stage5MigrationReport = {
    dryRun,
    documents: { attachments: 0, copied: 0, queued: 0 },
    quickReplies: { chatbots: 0, copied: 0, locked: 0 },
    parked: { connectors: 0, waConversations: 0 },
    defaults: { chatbots: 0 },
    owners: { assigned: 0, needsOwner: [] },
  };

  // 1. Shared library documents become per-chatbot copies.
  const attachments = (await dataSource.query(
    `SELECT cd.chatbot_id, cd.document_id
       FROM chatbot_documents cd
       JOIN kb_documents d ON d.id = cd.document_id
      WHERE d.owner_chatbot_id IS NULL AND d.archived_at IS NULL
        AND ($1 OR (SELECT count(*) FROM chatbot_documents x WHERE x.document_id = d.id) > 1)
      ORDER BY cd.chatbot_id`,
    [Boolean(options.allShared)],
  )) as { chatbot_id: string; document_id: string }[];
  report.documents.attachments = attachments.length;
  const jobs: CopyJob[] = [];
  if (!dryRun) {
    for (const a of attachments) {
      await dataSource.transaction(async (m) => {
        const { jobs: made } = await copyDocumentsTx(
          m,
          null,
          a.chatbot_id,
          0,
          [a.document_id],
          { tag: MIGRATION_COPY_TAG, keepCreator: true },
        );
        // The copy replaces the shared attachment (a copy made by an earlier run counts too).
        const [copy] = (await m.query(
          `SELECT id FROM kb_documents WHERE owner_chatbot_id = $1 AND copied_from_document_id = $2 AND archived_at IS NULL`,
          [a.chatbot_id, a.document_id],
        )) as { id: string }[];
        if (copy) {
          await m.query(
            `DELETE FROM chatbot_documents WHERE chatbot_id = $1 AND document_id = $2`,
            [a.chatbot_id, a.document_id],
          );
        }
        jobs.push(...made);
      });
    }
    report.documents.copied = jobs.length;
    for (const job of jobs) {
      if (!options.enqueue) break;
      await options.enqueue({
        documentId: job.id,
        action: job.action ?? 'ingest',
      });
      report.documents.queued += 1;
    }
  } else {
    report.documents.copied = attachments.length;
  }

  // 2. Per-chatbot quick replies; marks the copy done (builders stop resolving globals).
  const qr = await new QuickReplyCopyService(dataSource).copyAll({ dryRun });
  report.quickReplies = {
    chatbots: qr.chatbots,
    copied: qr.copied,
    locked: qr.locked,
  };

  // 3. Park what belongs to no chatbot.
  const parkConnectors = `FROM connectors WHERE chatbot_id IS NULL AND "deletedAt" IS NULL AND parked = false`;
  const parkThreads = `FROM wa_conversations WHERE chatbot_id IS NULL AND parked = false`;
  if (dryRun) {
    const [row] = (await dataSource.query(
      `SELECT (SELECT count(*)::int ${parkConnectors}) AS c, (SELECT count(*)::int ${parkThreads}) AS w`,
    )) as { c: number; w: number }[];
    report.parked = { connectors: row.c, waConversations: row.w };
  } else {
    report.parked.connectors = affectedOf(
      await dataSource.query(
        `UPDATE connectors SET parked = true, "updatedAt" = now()
          WHERE id IN (SELECT id ${parkConnectors})`,
      ),
    );
    report.parked.waConversations = affectedOf(
      await dataSource.query(
        `UPDATE wa_conversations SET parked = true, "updatedAt" = now()
          WHERE id IN (SELECT id ${parkThreads})`,
      ),
    );
  }

  // 4. Defaults: retention 90 days, audience age unstated (the strictest wording).
  const needsDefaults = `FROM chatbots WHERE NOT (settings ? 'retentionDays') OR NOT (settings ? 'audienceAge')`;
  if (dryRun) {
    const [row] = (await dataSource.query(
      `SELECT count(*)::int AS n ${needsDefaults}`,
    )) as { n: number }[];
    report.defaults.chatbots = row.n;
  } else {
    report.defaults.chatbots = affectedOf(
      await dataSource.query(
        `UPDATE chatbots
            SET settings = jsonb_build_object('retentionDays', $1::int, 'audienceAge', $2::text) || settings
          WHERE id IN (SELECT id ${needsDefaults})`,
        [SAFETY_DEFAULTS.retentionDays, SAFETY_DEFAULTS.audienceAge],
      ),
    );
  }

  // 5. Owners: the creator, where a chatbot has none.
  const owners = await backfillOwners(dataSource, { dryRun });
  report.owners = {
    assigned: owners.assigned.length,
    needsOwner: owners.needsOwner.map((b) => b.id),
  };
  return report;
}
