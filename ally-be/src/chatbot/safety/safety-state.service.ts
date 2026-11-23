import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';

/** One language's latest crisis check (stage 4). */
export interface LanguageCrisisResult {
  status: 'pass' | 'fail' | 'error';
  /** The suite version it ran (`crisis-cases.json`); a new version makes it stale. */
  suiteVersion: string;
  checkedAt: string;
  passed: number;
  total: number;
  /** Case ids that did not pass (never message text). */
  failedCases: string[];
  /** Set when a failure turned the language off for customers. */
  turnedOffAt?: string | null;
}

export type LanguageCrisisStatus = Record<string, LanguageCrisisResult>;

export interface ChatbotSafetyState {
  chatbotId: string;
  termsVersion: string | null;
  termsAcceptedAt: Date | null;
  termsAcceptedBy: number | null;
  languageCrisisStatus: LanguageCrisisStatus;
  pausedByGateAt: Date | null;
  pausedByGateReason: { missing: string[]; at: string } | null;
}

const EMPTY = (chatbotId: string): ChatbotSafetyState => ({
  chatbotId,
  termsVersion: null,
  termsAcceptedAt: null,
  termsAcceptedBy: null,
  languageCrisisStatus: {},
  pausedByGateAt: null,
  pausedByGateReason: null,
});

/**
 * `chatbot_safety_state` (migration 1987000000000): the go-live facts an editor's settings save
 * must never write or wipe. Raw SQL on one keyed row; every write is an upsert.
 */
@Injectable()
export class SafetyStateService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async get(
    chatbotId: string,
    manager: Pick<EntityManager, 'query'> = this.dataSource,
  ): Promise<ChatbotSafetyState> {
    const [row] = (await manager.query(
      `SELECT chatbot_id, terms_version, terms_accepted_at, terms_accepted_by,
              language_crisis_status, paused_by_gate_at, paused_by_gate_reason
         FROM chatbot_safety_state WHERE chatbot_id = $1`,
      [chatbotId],
    )) as Record<string, any>[];
    if (!row) return EMPTY(chatbotId);
    return {
      chatbotId,
      termsVersion: row.terms_version ?? null,
      termsAcceptedAt: row.terms_accepted_at ?? null,
      termsAcceptedBy: row.terms_accepted_by ?? null,
      languageCrisisStatus: (row.language_crisis_status ??
        {}) as LanguageCrisisStatus,
      pausedByGateAt: row.paused_by_gate_at ?? null,
      pausedByGateReason: row.paused_by_gate_reason ?? null,
    };
  }

  async acceptTerms(
    chatbotId: string,
    version: string,
    userId: number | null,
  ): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO chatbot_safety_state (chatbot_id, terms_version, terms_accepted_at, terms_accepted_by)
       VALUES ($1, $2, now(), $3)
       ON CONFLICT (chatbot_id) DO UPDATE
         SET terms_version = EXCLUDED.terms_version,
             terms_accepted_at = EXCLUDED.terms_accepted_at,
             terms_accepted_by = EXCLUDED.terms_accepted_by,
             "updatedAt" = now()`,
      [chatbotId, version, userId],
    );
  }

  /** Merge one language's result in (other languages are kept). */
  async setLanguageResult(
    chatbotId: string,
    language: string,
    result: LanguageCrisisResult,
  ): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO chatbot_safety_state (chatbot_id, language_crisis_status)
       VALUES ($1, jsonb_build_object($2::text, $3::jsonb))
       ON CONFLICT (chatbot_id) DO UPDATE
         SET language_crisis_status =
               chatbot_safety_state.language_crisis_status || jsonb_build_object($2::text, $3::jsonb),
             "updatedAt" = now()`,
      [chatbotId, language, JSON.stringify(result)],
    );
  }

  async markPausedByGate(
    chatbotId: string,
    missing: string[],
    manager: Pick<EntityManager, 'query'> = this.dataSource,
  ): Promise<void> {
    await manager.query(
      `INSERT INTO chatbot_safety_state (chatbot_id, paused_by_gate_at, paused_by_gate_reason)
       VALUES ($1, now(), $2::jsonb)
       ON CONFLICT (chatbot_id) DO UPDATE
         SET paused_by_gate_at = now(), paused_by_gate_reason = EXCLUDED.paused_by_gate_reason,
             "updatedAt" = now()`,
      [chatbotId, JSON.stringify({ missing, at: new Date().toISOString() })],
    );
  }

  /** The owner completed the gate and went live again. */
  async clearPausedByGate(chatbotId: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE chatbot_safety_state
          SET paused_by_gate_at = NULL, paused_by_gate_reason = NULL, "updatedAt" = now()
        WHERE chatbot_id = $1 AND paused_by_gate_at IS NOT NULL`,
      [chatbotId],
    );
  }
}
