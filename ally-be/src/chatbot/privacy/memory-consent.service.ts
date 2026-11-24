import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { LoggerService } from '../../logger/logger.service';
import type { ReplyLanguage } from '../engine/reply-language';
import { safetySettingsOf } from '../safety/safety-settings';
import { SWITCHES, switchOn } from '../safety/switches';
import { affectedOf } from './erased';
import { consentWording, noticeWording } from './memory-consent-copy';
import { memorySettingsOf } from '../memory/memory-settings';

export type ConsentState = 'unasked' | 'asked' | 'granted' | 'declined';

export interface ConsentView {
  state: ConsentState;
  /** `person:<end person id>` when the contact is a known end person, else `contact:<id>`. */
  subjectKey: string;
  wordingVersion: string | null;
}

/** The memory cutover's state row (D7). */
export const MEMORY_CUTOVER_STATE = 'memory_consent_cutover';

export interface MemoryCutoverReport {
  dryRun: boolean;
  blocked: 'switched_off' | null;
  /** Entries stored before the cutover began: what is (or would be) deleted. */
  entries: number;
  /** Chats whose rolling summary is cleared with them. */
  summaries: number;
  cutoverAt: string;
  alreadyDone: boolean;
}

/**
 * Memory consent (D7): stored per end person when known (so a person reached by phone and email
 * is asked once), else per contact. One question, the same step for everyone, worded by the
 * chatbot's audience age. Memory is written only once the answer is yes (`MemoryService.apply`).
 *
 * The engine asks; this service does not send anything. See the stage 5 notes for the hook.
 */
@Injectable()
export class MemoryConsentService {
  private readonly logger = LoggerService.getInstance(
    MemoryConsentService.name,
  );

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Optional() private readonly config?: ConfigService,
  ) {}

  /** The key consent is stored under for this contact. */
  async subjectFor(
    chatbotId: string,
    contactId: string,
  ): Promise<{ key: string; endPersonId: string | null }> {
    const [table] = (await this.dataSource.query(
      `SELECT to_regclass('end_person_identities') AS t`,
    )) as { t: string | null }[];
    if (table?.t) {
      const [row] = (await this.dataSource.query(
        `SELECT e.end_person_id FROM chatbot_contact_identities i
           JOIN end_person_identities e
             ON e.chatbot_id = i.chatbot_id
            AND (lower(e.value) = lower(i.external_id)
                 OR regexp_replace(e.value, '[^0-9]', '', 'g') = regexp_replace(i.external_id, '[^0-9]', '', 'g')
                    AND length(regexp_replace(i.external_id, '[^0-9]', '', 'g')) >= 10)
          WHERE i.contact_id = $1 AND i.chatbot_id = $2
          LIMIT 1`,
        [contactId, chatbotId],
      )) as { end_person_id: string }[];
      if (row) {
        return {
          key: `person:${row.end_person_id}`,
          endPersonId: row.end_person_id,
        };
      }
    }
    return { key: `contact:${contactId}`, endPersonId: null };
  }

  async stateFor(chatbotId: string, contactId: string): Promise<ConsentView> {
    const subject = await this.subjectFor(chatbotId, contactId);
    const rows = (await this.dataSource.query(
      `SELECT subject_key, state, wording_version FROM memory_consents
        WHERE chatbot_id = $1 AND subject_key = ANY($2::text[])`,
      [chatbotId, [subject.key, `contact:${contactId}`]],
    )) as {
      subject_key: string;
      state: ConsentState;
      wording_version: string;
    }[];
    // The person's answer wins over an older answer stored on this contact alone.
    const row =
      rows.find((r) => r.subject_key === subject.key) ??
      rows.find((r) => r.subject_key === `contact:${contactId}`);
    return {
      state: row?.state ?? 'unasked',
      subjectKey: subject.key,
      wordingVersion: row?.wording_version ?? null,
    };
  }

  /** Whether memory may be written for this contact. */
  async isGranted(chatbotId: string, contactId: string): Promise<boolean> {
    return (await this.stateFor(chatbotId, contactId)).state === 'granted';
  }

  /**
   * The consent question for this contact, recorded as asked. Null when they already answered
   * (one question, never repeated). Worded by the chatbot's audience age.
   */
  async ask(
    chatbotId: string,
    contactId: string,
    language: ReplyLanguage,
    now: Date = new Date(),
  ): Promise<{ text: string; wordingVersion: string } | null> {
    const view = await this.stateFor(chatbotId, contactId);
    if (view.state === 'granted' || view.state === 'declined') return null;
    const [bot] = (await this.dataSource.query(
      `SELECT settings FROM chatbots WHERE id = $1`,
      [chatbotId],
    )) as { settings: Record<string, unknown> | null }[];
    const audienceAge = safetySettingsOf(bot?.settings as never).audienceAge;
    // TF1 B1: a template's notice, for adults: told, not asked, and memory starts; "forget me"
    // (erase in chat) removes it at any time. Young or unstated audiences are still asked.
    const notice = memorySettingsOf({
      settings: bot?.settings as never,
    }).notice;
    if (notice && audienceAge === 'adults') {
      const told = noticeWording(notice, language);
      await this.record(chatbotId, contactId, 'granted', told.version, now);
      return { text: told.text, wordingVersion: told.version };
    }
    const wording = consentWording(audienceAge, language);
    const subject = await this.subjectFor(chatbotId, contactId);
    await this.dataSource.query(
      `INSERT INTO memory_consents (chatbot_id, subject_key, end_person_id, contact_id, state, asked_at, wording_version)
       VALUES ($1, $2, $3, $4, 'asked', $5, $6)
       ON CONFLICT (chatbot_id, subject_key) DO UPDATE
         SET asked_at = EXCLUDED.asked_at, wording_version = EXCLUDED.wording_version, "updatedAt" = now()
         WHERE memory_consents.state = 'asked'`,
      [
        chatbotId,
        subject.key,
        subject.endPersonId,
        contactId,
        now,
        wording.version,
      ],
    );
    return { text: wording.text, wordingVersion: wording.version };
  }

  /** Store the person's answer. */
  async record(
    chatbotId: string,
    contactId: string,
    decision: 'granted' | 'declined',
    wordingVersion: string,
    now: Date = new Date(),
  ): Promise<ConsentView> {
    const subject = await this.subjectFor(chatbotId, contactId);
    await this.dataSource.query(
      `INSERT INTO memory_consents (chatbot_id, subject_key, end_person_id, contact_id, state, decided_at, wording_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (chatbot_id, subject_key) DO UPDATE
         SET state = EXCLUDED.state, decided_at = EXCLUDED.decided_at,
             wording_version = EXCLUDED.wording_version, "updatedAt" = now()`,
      [
        chatbotId,
        subject.key,
        subject.endPersonId,
        contactId,
        decision,
        now,
        wordingVersion,
      ],
    );
    if (decision === 'declined') {
      // A no means nothing is kept: lines from before the answer go too.
      await this.dataSource.query(
        `DELETE FROM memory_entries WHERE chatbot_id = $1 AND contact_id = $2`,
        [chatbotId, contactId],
      );
    }
    return this.stateFor(chatbotId, contactId);
  }

  /**
   * The cutover step (D7): delete every memory line stored before consent existed, and the
   * rolling summaries with them. Idempotent: the cutover time is fixed by the first real run and
   * reused, so a second run never deletes memory stored with consent afterwards. Behind
   * ASSISTANT_MEMORY_CUTOVER_ENABLED; a dry run counts and writes nothing.
   */
  async cutover(
    options: { dryRun?: boolean; now?: Date } = {},
  ): Promise<MemoryCutoverReport> {
    const dryRun = options.dryRun ?? false;
    const now = options.now ?? new Date();
    const [state] = (await this.dataSource.query(
      `SELECT id, value FROM global_settings WHERE name = $1 LIMIT 1`,
      [MEMORY_CUTOVER_STATE],
    )) as { id: string; value: { cutoverAt?: string; doneAt?: string } }[];
    const cutoverAt = state?.value?.cutoverAt ?? now.toISOString();
    const report: MemoryCutoverReport = {
      dryRun,
      blocked: null,
      entries: 0,
      summaries: 0,
      cutoverAt,
      alreadyDone: Boolean(state?.value?.doneAt),
    };
    const [counts] = (await this.dataSource.query(
      `SELECT (SELECT count(*)::int FROM memory_entries WHERE "createdAt" < $1) AS entries,
              (SELECT count(*)::int FROM chatbot_conversations
                WHERE summary IS NOT NULL AND "updatedAt" < $1) AS summaries`,
      [cutoverAt],
    )) as { entries: number; summaries: number }[];
    report.entries = Number(counts?.entries ?? 0);
    report.summaries = Number(counts?.summaries ?? 0);
    if (dryRun) return report;
    if (!switchOn(this.config, SWITCHES.memoryCutover)) {
      return { ...report, blocked: 'switched_off', entries: 0, summaries: 0 };
    }
    if (!state) {
      await this.dataSource.query(
        `INSERT INTO global_settings (name, value, "createdBy", "updatedBy") VALUES ($1, $2::jsonb, 0, 0)`,
        [MEMORY_CUTOVER_STATE, JSON.stringify({ cutoverAt })],
      );
    }
    report.entries = affectedOf(
      await this.dataSource.query(
        `DELETE FROM memory_entries WHERE "createdAt" < $1`,
        [cutoverAt],
      ),
    );
    report.summaries = affectedOf(
      await this.dataSource.query(
        `UPDATE chatbot_conversations
            SET summary = NULL, metadata = metadata - 'summaryUpto'
          WHERE summary IS NOT NULL AND "updatedAt" < $1`,
        [cutoverAt],
      ),
    );
    await this.dataSource.query(
      `UPDATE global_settings SET value = value || $2::jsonb, "updatedAt" = now() WHERE name = $1`,
      [
        MEMORY_CUTOVER_STATE,
        JSON.stringify({
          doneAt: new Date().toISOString(),
          deleted: report.entries,
        }),
      ],
    );
    this.logger.info(
      `[MEMORY-CUTOVER] ${report.entries} line(s), ${report.summaries} summary(ies) before ${cutoverAt}`,
    );
    return report;
  }
}
