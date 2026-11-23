import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { CRISIS_SUITE } from '../../../chatbot/safety/crisis-suite/crisis-suite';
import { AlertOutboxService } from '../../../chatbot/safety/alert-outbox.service';
import { SWITCHES, switchOn } from '../../../chatbot/safety/switches';
import { ChatbotAccessService } from '../../../chatbot/service/chatbot-access.service';
import { ChatbotMemberRole } from '../../../chatbot/enum/chatbot.enum';
import { LoggerService } from '../../../logger/logger.service';
import { CrisisSuiteService } from '../../checkup/crisis-suite.service';
import { SafetyPackId } from '../../enum/bot-draft.enum';
import {
  clearLivePacks,
  setLivePacks,
  type LivePackEntry,
} from '../live-packs';
import { codePackFor, SAFETY_PACKS, type SafetyPack } from '../safety-packs';
import {
  applyEdit,
  contentHash,
  diffPacks,
  materialise,
  noticeText,
  ReleaseContentError,
  releaseBlockers,
  SUITE_STALE_MS,
  supportedLanguages,
  type EditablePackContent,
  type ReleaseStatus,
  type ReleaseTestResults,
} from './release-content';

/** How often each instance reloads the current releases (another instance may have released). */
export const PACK_RELEASE_REFRESH_MS = 30_000;

interface ReleaseRow {
  id: string;
  pack_id: string;
  version: number;
  content: Partial<SafetyPack>;
  status: ReleaseStatus;
  test_results: ReleaseTestResults | null;
  previous_release_id: string | null;
  note: string | null;
  created_by: number | null;
  created_at: Date;
  updated_at: Date;
  released_at: Date | null;
  released_by: number | null;
  rolled_back_at: Date | null;
  rolled_back_by: number | null;
  notices_queued_at: Date | null;
}

export interface ReleaseView {
  id: string;
  packId: string;
  version: number;
  status: ReleaseStatus;
  current: boolean;
  note: string | null;
  createdBy: number | null;
  createdAt: string;
  releasedAt: string | null;
  releasedBy: number | null;
  rolledBackAt: string | null;
  rolledBackBy: number | null;
  previousReleaseId: string | null;
  testResults: ReleaseTestResults | null;
}

function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result) && Array.isArray(result[0]))
    return result[0] as T[];
  return Array.isArray(result) ? (result as T[]) : [];
}

const iso = (d: Date | string | null | undefined) =>
  d ? new Date(d).toISOString() : null;

function codeOf(packId: string): SafetyPack {
  const code = codePackFor(packId);
  if (!code) throw new NotFoundException('Safety pack not found');
  return code;
}

/**
 * Stage 9: safety packs as released data. A curator (`manage:safety-packs`) drafts a new version
 * from the current one, runs the crisis suite against it in every supported language (Ally pays,
 * `pack_suite`), and releases it only when every language passes. Releasing moves the pack's
 * pointer: every chatbot on the pack uses it on its next turn (their stored `safety_pack_version`
 * follows in the background), and owners get one email. Any curator can roll back in one step:
 * the pointer goes back to the release before, and owners are told.
 *
 * The engine reads packs synchronously through `packFor`, so the current releases are held in
 * memory (`live-packs.ts`), loaded on boot, refreshed every 30 s and at once after a change here.
 * With `ASSISTANT_PACK_RELEASES_ENABLED=false`, or before anything is loaded, the code constants
 * are used, exactly as before stage 9.
 */
@Injectable()
export class SafetyPackReleaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = LoggerService.getInstance(
    SafetyPackReleaseService.name,
  );
  private timer: NodeJS.Timeout | null = null;
  private readonly warnedNewerCode = new Set<string>();

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly suite: CrisisSuiteService,
    private readonly access: ChatbotAccessService,
    @Optional() private readonly config?: ConfigService,
    @Optional() private readonly outbox?: AlertOutboxService,
  ) {}

  enabled(): boolean {
    return switchOn(this.config, SWITCHES.packReleases);
  }

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;
    void this.ensureSeeded()
      .then(() => this.refresh())
      .catch((error) =>
        this.logger.warn(
          `Safety pack releases not loaded; using the code packs: ${error instanceof Error ? error.message : 'unknown'}`,
        ),
      );
    this.timer = setInterval(() => {
      void this.refresh().catch(() => undefined);
    }, PACK_RELEASE_REFRESH_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  // ── the read path ─────────────────────────────────────────────────────

  /**
   * Reload the current release of every pack into memory. A failed load keeps what was loaded
   * (released content, never a guess); switched off, the code packs are used.
   */
  async refresh(): Promise<void> {
    if (!this.enabled()) {
      clearLivePacks();
      return;
    }
    const rows = rowsOf<ReleaseRow>(
      await this.dataSource.query(
        `SELECT r.* FROM safety_pack_current c
           JOIN safety_pack_releases r ON r.id = c.release_id`,
      ),
    );
    const entries: LivePackEntry[] = [];
    for (const row of rows) {
      const code = codePackFor(row.pack_id);
      if (!code) continue; // a pack removed from code is not served
      if (code.version > row.version && !this.warnedNewerCode.has(row.id)) {
        this.warnedNewerCode.add(row.id);
        this.logger.warn(
          `Safety pack ${row.pack_id}: code has version ${code.version}, the current release is ${row.version}. The release is served; create a draft from code and release it to use the code version.`,
        );
      }
      entries.push({
        releaseId: row.id,
        version: row.version,
        pack: materialise(code, row.content, row.version),
      });
    }
    setLivePacks(entries);
  }

  /**
   * Each pack's first release, from its code constant, when the pack has no current release yet.
   * Idempotent and safe on several instances at once.
   */
  async ensureSeeded(): Promise<void> {
    for (const pack of Object.values(SAFETY_PACKS)) {
      await this.dataSource.query(
        `INSERT INTO safety_pack_releases
           (pack_id, version, content, status, released_at, note)
         SELECT $1::varchar, $2::int, $3::jsonb, 'released', now(), 'Seeded from the code pack'
          WHERE NOT EXISTS (SELECT 1 FROM safety_pack_current WHERE pack_id = $1::varchar)
         ON CONFLICT (pack_id, version) DO NOTHING`,
        [pack.id, pack.version, JSON.stringify(pack)],
      );
      await this.dataSource.query(
        `INSERT INTO safety_pack_current (pack_id, release_id)
         SELECT $1::varchar, id FROM safety_pack_releases
          WHERE pack_id = $1::varchar AND version = $2::int AND status = 'released'
         ON CONFLICT (pack_id) DO NOTHING`,
        [pack.id, pack.version],
      );
    }
  }

  // ── the curator's screens ─────────────────────────────────────────────

  async list() {
    await this.ensureSeeded();
    const current = rowsOf<{ pack_id: string; release_id: string }>(
      await this.dataSource.query(
        `SELECT pack_id, release_id FROM safety_pack_current`,
      ),
    );
    const currentByPack = new Map(
      current.map((c) => [c.pack_id, c.release_id]),
    );
    const rows = rowsOf<ReleaseRow>(
      await this.dataSource.query(
        `SELECT * FROM safety_pack_releases ORDER BY pack_id, version DESC`,
      ),
    );
    const counts = rowsOf<{ safety_pack: string; n: string }>(
      await this.dataSource.query(
        `SELECT safety_pack, count(*)::text AS n FROM chatbots
          WHERE archived_at IS NULL AND safety_pack IS NOT NULL GROUP BY safety_pack`,
      ),
    );
    const chatbots = new Map(counts.map((c) => [c.safety_pack, Number(c.n)]));
    return {
      enabled: this.enabled(),
      languages: supportedLanguages(),
      suiteVersion: CRISIS_SUITE.version,
      packs: Object.values(SAFETY_PACKS).map((code) => {
        const currentId = currentByPack.get(code.id) ?? null;
        const releases = rows
          .filter((r) => r.pack_id === code.id)
          .slice(0, 20)
          .map((r) => this.view(r, currentId));
        const live = releases.find((r) => r.id === currentId) ?? null;
        return {
          packId: code.id,
          name: code.curatorName ?? code.name,
          codeVersion: code.version,
          currentReleaseId: currentId,
          currentVersion: live?.version ?? null,
          canRollBack: Boolean(live?.previousReleaseId),
          chatbots: chatbots.get(code.id) ?? 0,
          releases,
        };
      }),
    };
  }

  /** One release with its full content and what it changes against the current release. */
  async get(releaseId: string) {
    const row = await this.row(releaseId);
    const currentRow = await this.currentRow(row.pack_id);
    const code = codeOf(row.pack_id);
    const content = materialise(code, row.content, row.version);
    const base = currentRow
      ? materialise(code, currentRow.content, currentRow.version)
      : code;
    return {
      ...this.view(row, currentRow?.id ?? null),
      content,
      currentContent: base,
      diff: diffPacks(base, content),
      blockers:
        row.status === 'draft' || row.status === 'testing'
          ? releaseBlockers(
              { status: row.status, testResults: row.test_results },
              content,
            )
          : [],
    };
  }

  /** A new draft from the current release (or from the code pack). */
  async createDraft(
    packId: string,
    input: { source?: 'current' | 'code'; note?: string | null },
    userId: number | null,
  ) {
    const code = codeOf(packId);
    await this.ensureSeeded();
    const currentRow = await this.currentRow(packId);
    const base =
      input.source === 'code' || !currentRow
        ? code
        : materialise(code, currentRow.content, currentRow.version);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const [row] = rowsOf<ReleaseRow>(
          await this.dataSource.query(
            `INSERT INTO safety_pack_releases (pack_id, version, content, status, note, created_by)
             SELECT $1::varchar, GREATEST(COALESCE(MAX(version), 0), $2::int) + 1, $3::jsonb, 'draft', $4::text, $5::int
               FROM safety_pack_releases WHERE pack_id = $1::varchar
             RETURNING *`,
            [
              packId,
              code.version,
              JSON.stringify(base),
              input.note?.trim() || null,
              userId,
            ],
          ),
        );
        return this.get(row.id);
      } catch (error) {
        // Two drafts at once took the same version: try the next one.
        if ((error as { code?: string })?.code !== '23505') throw error;
      }
    }
    throw new ConflictException('Could not create a draft; try again');
  }

  /** Change a draft. Any earlier suite result no longer applies. */
  async updateDraft(
    releaseId: string,
    change: EditablePackContent,
    note: string | null | undefined,
  ) {
    const row = await this.row(releaseId);
    this.assertEditable(row);
    const code = codeOf(row.pack_id);
    let next: SafetyPack;
    try {
      next = applyEdit(
        materialise(code, row.content, row.version),
        code,
        change,
      );
    } catch (error) {
      if (error instanceof ReleaseContentError)
        throw new BadRequestException({
          message: 'This change is not allowed',
          errorCode: error.code,
        });
      throw error;
    }
    await this.dataSource.query(
      `UPDATE safety_pack_releases
          SET content = $2::jsonb, status = 'draft', test_results = NULL,
              note = COALESCE($3::text, note), updated_at = now()
        WHERE id = $1`,
      [
        releaseId,
        JSON.stringify({ ...next, version: row.version }),
        note ?? null,
      ],
    );
    return this.get(releaseId);
  }

  /**
   * Start the crisis suite on a draft against `chatbotId` (a chatbot the curator can edit), in
   * every supported language. Runs in the background; the release shows `running` until done.
   */
  async startSuite(
    releaseId: string,
    chatbotId: string,
    userId: number | null,
  ) {
    const row = await this.row(releaseId);
    this.assertEditable(row);
    await this.access.assert(chatbotId, ChatbotMemberRole.EDITOR);
    const code = codeOf(row.pack_id);
    const pack = materialise(code, row.content, row.version);
    const startedAt = new Date().toISOString();
    const results: ReleaseTestResults = {
      state: 'running',
      chatbotId,
      contentHash: contentHash(pack),
      suiteVersion: CRISIS_SUITE.version,
      startedAt,
      startedBy: userId,
      languages: [],
      allPassed: false,
    };
    // Claimed in one statement: a second start while one runs (and is not stale) is refused.
    const claimed = rowsOf<{ id: string }>(
      await this.dataSource.query(
        `UPDATE safety_pack_releases
            SET status = 'testing', test_results = $2::jsonb, updated_at = now()
          WHERE id = $1 AND status IN ('draft', 'testing')
            AND (test_results IS NULL OR test_results->>'state' <> 'running'
                 OR (test_results->>'startedAt')::timestamptz < now() - ($3 || ' milliseconds')::interval)
          RETURNING id`,
        [releaseId, JSON.stringify(results), String(SUITE_STALE_MS)],
      ),
    );
    if (!claimed.length)
      throw new ConflictException({
        message: 'The crisis check is already running on this draft',
        errorCode: 'suite_running',
      });
    void this.runSuite(releaseId, pack, results);
    return this.get(releaseId);
  }

  /** The suite itself (awaited by tests; `startSuite` does not wait for it). */
  async runSuite(
    releaseId: string,
    pack: SafetyPack,
    started: ReleaseTestResults,
  ): Promise<ReleaseTestResults> {
    const languages = supportedLanguages();
    let done: ReleaseTestResults;
    try {
      const results = await this.suite.runForPack(
        started.chatbotId,
        { packId: pack.id, pack },
        languages,
      );
      const byLanguage = results.map((r) => ({
        language: r.language,
        status: r.status,
        passed: r.passed,
        total: r.total,
        failedCases: r.failedCases,
        checkedAt: r.checkedAt,
      }));
      done = {
        ...started,
        state: 'done',
        finishedAt: new Date().toISOString(),
        languages: byLanguage,
        allPassed:
          languages.length > 0 &&
          languages.every(
            (l) => byLanguage.find((r) => r.language === l)?.status === 'pass',
          ),
      };
    } catch (error) {
      this.logger.warn(
        `Pack suite for release ${releaseId} did not run: ${error instanceof Error ? error.name : 'error'}`,
      );
      const status = (error as { getStatus?: () => number })?.getStatus?.();
      done = {
        ...started,
        state: 'error',
        finishedAt: new Date().toISOString(),
        error: status ? `http_${status}` : 'not_run',
      };
    }
    // Only over the run that started it: an edit or a newer run meanwhile wins.
    await this.dataSource.query(
      `UPDATE safety_pack_releases SET test_results = $2::jsonb, updated_at = now()
        WHERE id = $1 AND test_results->>'startedAt' = $3`,
      [releaseId, JSON.stringify(done), started.startedAt],
    );
    return done;
  }

  /**
   * Release a tested draft: only when every supported language passed on this exact content.
   * No override. The pack's pointer moves to it, chatbots follow, owners are told once.
   */
  async release(releaseId: string, userId: number | null) {
    const outcome = await this.dataSource.transaction(async (m) => {
      const row = await this.lockedRow(m, releaseId);
      const code = codeOf(row.pack_id);
      const pack = materialise(code, row.content, row.version);
      const blockers = releaseBlockers(
        { status: row.status, testResults: row.test_results },
        pack,
      );
      if (blockers.length) {
        throw new ConflictException({
          message:
            'This release has not passed the crisis check in every language',
          errorCode: 'release_blocked',
          blockers,
        });
      }
      const pointer = await this.lockedPointer(m, row.pack_id);
      await m.query(
        `UPDATE safety_pack_releases
            SET status = 'released', released_at = now(), released_by = $2,
                previous_release_id = $3, updated_at = now()
          WHERE id = $1`,
        [releaseId, userId, pointer?.release_id ?? null],
      );
      await this.movePointer(m, row.pack_id, releaseId, userId);
      const before = pointer
        ? await this.lockedRow(m, pointer.release_id)
        : null;
      return {
        packId: row.pack_id,
        version: row.version,
        before: before
          ? materialise(code, before.content, before.version)
          : code,
        after: pack,
      };
    });
    await this.afterMove(outcome.packId, outcome.version);
    await this.noticeOwners({
      kind: 'release',
      releaseId,
      packId: outcome.packId,
      version: outcome.version,
      before: outcome.before,
      after: outcome.after,
    });
    return this.get(releaseId);
  }

  /** One click, any curator: the pack goes back to the release before the current one. */
  async rollback(packId: string, userId: number | null, note?: string | null) {
    const code = codeOf(packId);
    const outcome = await this.dataSource.transaction(async (m) => {
      const pointer = await this.lockedPointer(m, packId);
      if (!pointer) throw this.nothingToRollBack();
      const current = await this.lockedRow(m, pointer.release_id);
      if (!current.previous_release_id) throw this.nothingToRollBack();
      const previous = await this.lockedRow(m, current.previous_release_id);
      if (previous.status !== 'released') throw this.nothingToRollBack();
      await m.query(
        `UPDATE safety_pack_releases
            SET status = 'rolled_back', rolled_back_at = now(), rolled_back_by = $2,
                note = CASE WHEN $3::text IS NULL THEN note
                            ELSE concat_ws(E'\\n', note, 'Rolled back: ' || $3::text) END,
                updated_at = now()
          WHERE id = $1`,
        [current.id, userId, note?.trim() || null],
      );
      await this.movePointer(m, packId, previous.id, userId);
      return {
        rolledBackId: current.id,
        version: previous.version,
        restoredId: previous.id,
        before: materialise(code, current.content, current.version),
        after: materialise(code, previous.content, previous.version),
      };
    });
    await this.afterMove(packId, outcome.version);
    await this.noticeOwners({
      kind: 'rollback',
      releaseId: outcome.rolledBackId,
      packId,
      version: outcome.version,
      before: outcome.before,
      after: outcome.after,
    });
    return this.get(outcome.restoredId);
  }

  // ── helpers ───────────────────────────────────────────────────────────

  private nothingToRollBack() {
    return new ConflictException({
      message: 'There is no earlier release to go back to',
      errorCode: 'nothing_to_roll_back',
    });
  }

  private assertEditable(row: ReleaseRow): void {
    if (row.status !== 'draft' && row.status !== 'testing') {
      throw new ConflictException({
        message: 'Only a draft can be changed or tested',
        errorCode: 'not_a_draft',
      });
    }
  }

  private async row(id: string): Promise<ReleaseRow> {
    const [row] = rowsOf<ReleaseRow>(
      await this.dataSource.query(
        `SELECT * FROM safety_pack_releases WHERE id = $1`,
        [id],
      ),
    );
    if (!row) throw new NotFoundException('Release not found');
    return row;
  }

  private async lockedRow(m: EntityManager, id: string): Promise<ReleaseRow> {
    const [row] = rowsOf<ReleaseRow>(
      await m.query(
        `SELECT * FROM safety_pack_releases WHERE id = $1 FOR UPDATE`,
        [id],
      ),
    );
    if (!row) throw new NotFoundException('Release not found');
    return row;
  }

  private async lockedPointer(m: EntityManager, packId: string) {
    const [pointer] = rowsOf<{ pack_id: string; release_id: string }>(
      await m.query(
        `SELECT pack_id, release_id FROM safety_pack_current WHERE pack_id = $1 FOR UPDATE`,
        [packId],
      ),
    );
    return pointer ?? null;
  }

  private async movePointer(
    m: EntityManager,
    packId: string,
    releaseId: string,
    userId: number | null,
  ) {
    await m.query(
      `INSERT INTO safety_pack_current (pack_id, release_id, updated_by, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (pack_id) DO UPDATE
         SET release_id = EXCLUDED.release_id, updated_by = EXCLUDED.updated_by,
             updated_at = now()`,
      [packId, releaseId, userId],
    );
  }

  private async currentRow(packId: string): Promise<ReleaseRow | null> {
    const [row] = rowsOf<ReleaseRow>(
      await this.dataSource.query(
        `SELECT r.* FROM safety_pack_current c
           JOIN safety_pack_releases r ON r.id = c.release_id
          WHERE c.pack_id = $1`,
        [packId],
      ),
    );
    return row ?? null;
  }

  /** This instance serves the new pointer at once; chatbots' stored version follows lazily. */
  private async afterMove(packId: string, version: number): Promise<void> {
    await this.refresh().catch((error) =>
      this.logger.warn(
        `Safety pack reload after a release failed (next refresh retries): ${error instanceof Error ? error.message : 'unknown'}`,
      ),
    );
    void this.dataSource
      .query(
        `UPDATE chatbots SET safety_pack_version = $2::int
          WHERE safety_pack = $1::varchar AND safety_pack_version IS DISTINCT FROM $2::int`,
        [packId, version],
      )
      .catch(() => undefined);
  }

  /**
   * One email per owner per release (or rollback), listing their chatbots on the pack. Guarded
   * twice: the release row's `notices_queued_at` is claimed once, and each outbox row has a
   * dedupe key.
   */
  async noticeOwners(input: {
    kind: 'release' | 'rollback';
    releaseId: string;
    packId: string;
    version: number;
    before: SafetyPack;
    after: SafetyPack;
  }): Promise<number> {
    if (!this.outbox) return 0;
    if (input.kind === 'release') {
      const claimed = rowsOf<{ id: string }>(
        await this.dataSource.query(
          `UPDATE safety_pack_releases SET notices_queued_at = now()
            WHERE id = $1 AND notices_queued_at IS NULL RETURNING id`,
          [input.releaseId],
        ),
      );
      if (!claimed.length) return 0;
    }
    const owners = rowsOf<{
      email: string;
      chatbot_id: string;
      names: string[];
    }>(
      await this.dataSource.query(
        `SELECT u.email,
                (array_agg(b.id::text ORDER BY b.id))[1] AS chatbot_id,
                array_agg(DISTINCT b.name) AS names
           FROM chatbots b
           JOIN chatbot_members m ON m.chatbot_id = b.id
           JOIN users u ON u.id = m.user_id
          WHERE b.safety_pack = $1 AND b.archived_at IS NULL AND u.email IS NOT NULL
            AND (m.role = 'owner' OR 'owner' = ANY(m.roles))
          GROUP BY u.email`,
        [input.packId],
      ),
    );
    const diff = diffPacks(input.before, input.after);
    let queued = 0;
    for (const owner of owners) {
      const { subject, body } = noticeText({
        kind: input.kind,
        packName: input.after.name,
        version: input.version,
        chatbotNames: owner.names ?? [],
        diff,
      });
      const added = await this.outbox
        .enqueue({
          chatbotId: owner.chatbot_id,
          kind:
            input.kind === 'release'
              ? 'safety_pack_release'
              : 'safety_pack_rollback',
          recipient: owner.email,
          channel: 'email',
          payload: { subject, body },
          dedupeKey: `pack-${input.kind}:${input.releaseId}:${owner.email}`,
        })
        .catch((error) => {
          this.logger.warn(
            `Pack notice not queued: ${error instanceof Error ? error.message : 'unknown'}`,
          );
          return false;
        });
      if (added) queued += 1;
    }
    return queued;
  }

  private view(row: ReleaseRow, currentId: string | null): ReleaseView {
    return {
      id: row.id,
      packId: row.pack_id,
      version: row.version,
      status: row.status,
      current: row.id === currentId,
      note: row.note,
      createdBy: row.created_by,
      createdAt: iso(row.created_at)!,
      releasedAt: iso(row.released_at),
      releasedBy: row.released_by,
      rolledBackAt: iso(row.rolled_back_at),
      rolledBackBy: row.rolled_back_by,
      previousReleaseId: row.previous_release_id,
      testResults: row.test_results,
    };
  }
}

export const SAFETY_PACK_IDS = Object.values(SafetyPackId) as string[];
