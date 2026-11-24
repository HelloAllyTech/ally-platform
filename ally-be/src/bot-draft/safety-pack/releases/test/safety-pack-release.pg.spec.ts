import { ConflictException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  closeTestDataSource,
  describePg,
  openTestDataSource,
  resetTables,
} from '../../../../whatsapp/shared-store/test/shared-store.pg';
import { AlertOutboxService } from '../../../../chatbot/safety/alert-outbox.service';
import { SafetyPackId } from '../../../enum/bot-draft.enum';
import { clearLivePacks } from '../../live-packs';
import { packFor, SAFETY_PACKS } from '../../safety-packs';
import { supportedLanguages } from '../release-content';
import { SafetyPackReleaseService } from '../safety-pack-release.service';

const PACK = SafetyPackId.MENTAL_HEALTH;
const code = SAFETY_PACKS[PACK];

/**
 * Stage 9 on real Postgres: the seed from code, the release gate refusing a failing language,
 * releasing (pointer, engine read, chatbots' stored version, one owner notice) and rollback.
 */
describePg('Safety pack releases (Postgres)', () => {
  let dataSource: DataSource;
  let service: SafetyPackReleaseService;
  let failLanguage: string | null = null;
  let suiteCalls = 0;
  const switches: Record<string, string> = {};
  let bot: string;

  const suite = {
    runForPack: async (
      _chatbotId: string,
      override: { pack: { rules: string[] } },
      languages: string[],
    ) => {
      suiteCalls += 1;
      expect(override.pack.rules.length).toBeGreaterThan(0);
      return languages.map((language) => ({
        language,
        status: language === failLanguage ? 'fail' : 'pass',
        passed: language === failLanguage ? 0 : 3,
        total: 3,
        failedCases: language === failLanguage ? ['x'] : [],
        suiteVersion: 'ignored',
        checkedAt: new Date().toISOString(),
      }));
    },
  };

  beforeAll(async () => {
    dataSource = await openTestDataSource();
    service = new SafetyPackReleaseService(
      dataSource,
      suite as never,
      { assert: async () => ({}) } as never,
      { get: (name: string) => switches[name] } as never,
      new AlertOutboxService(dataSource),
    );
  });
  afterAll(async () => {
    clearLivePacks();
    await closeTestDataSource(dataSource);
  });

  beforeEach(async () => {
    clearLivePacks();
    failLanguage = null;
    suiteCalls = 0;
    delete switches.ASSISTANT_PACK_RELEASES_ENABLED;
    await resetTables(dataSource);
    await dataSource.query(
      `TRUNCATE safety_pack_current, safety_pack_releases, alert_outbox, chatbot_members, users CASCADE`,
    );
    await dataSource.query(
      `INSERT INTO users (id, email, name, status, username, tenant_id)
       VALUES (1, 'owner@example.test', 'Owner', 'active', 'owner', 't1')`,
    );
    const [row] = await dataSource.query(
      `INSERT INTO chatbots (name, created_by, status, safety_pack, safety_pack_version)
       VALUES ('Calm bot', 1, 'live', $1, $2) RETURNING id`,
      [PACK, code.version],
    );
    bot = row.id;
    await dataSource.query(
      `INSERT INTO chatbot_members (chatbot_id, user_id, role, roles)
       VALUES ($1, 1, 'owner', ARRAY['owner'])`,
      [bot],
    );
  });

  const tested = async (rule = 'A new rule for the release.') => {
    const draft = await service.createDraft(PACK, {}, 1);
    await service.updateDraft(draft.id, { rules: [...code.rules, rule] }, null);
    const started = await service.startSuite(draft.id, bot, 1);
    expect(started.status).toBe('testing');
    // Wait for the background run to finish.
    for (let i = 0; i < 50; i += 1) {
      const view = await service.get(draft.id);
      if (view.testResults?.state !== 'running') return view;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('suite did not finish');
  };

  it('seeds each pack from code, once, so behaviour is unchanged', async () => {
    await service.ensureSeeded();
    await service.ensureSeeded();
    const rows = await dataSource.query(
      `SELECT pack_id, version, status FROM safety_pack_releases`,
    );
    expect(rows).toHaveLength(Object.keys(SAFETY_PACKS).length);
    await service.refresh();
    expect(packFor(PACK)).toEqual(code);
  });

  it('refuses to release when a supported language fails', async () => {
    failLanguage = supportedLanguages()[0];
    const draft = await tested();
    expect(draft.blockers).toEqual([`language_failed:${failLanguage}`]);
    await expect(service.release(draft.id, 1)).rejects.toBeInstanceOf(
      ConflictException,
    );
    const [pointer] = await dataSource.query(
      `SELECT r.version FROM safety_pack_current c JOIN safety_pack_releases r ON r.id = c.release_id WHERE c.pack_id = $1`,
      [PACK],
    );
    expect(pointer.version).toBe(code.version);
  });

  it('refuses a release whose content changed after the suite', async () => {
    const draft = await tested();
    await service.updateDraft(draft.id, { rules: ['Edited after.'] }, null);
    await expect(service.release(draft.id, 1)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('releases: the engine reads it, chatbots follow, the owner is told once', async () => {
    const draft = await tested('Released rule.');
    expect(suiteCalls).toBe(1);
    const released = await service.release(draft.id, 1);
    expect(released.status).toBe('released');
    expect(released.current).toBe(true);
    expect(packFor(PACK)?.rules).toContain('Released rule.');
    expect(packFor(PACK)?.version).toBe(code.version + 1);

    // Notices: one row, and a repeat of the notice step queues nothing more.
    const again = await service.noticeOwners({
      kind: 'release',
      releaseId: draft.id,
      packId: PACK,
      version: draft.version,
      before: code,
      after: code,
    });
    expect(again).toBe(0);
    const notices = await dataSource.query(
      `SELECT kind, recipient, payload FROM alert_outbox`,
    );
    expect(notices).toHaveLength(1);
    expect(notices[0].kind).toBe('safety_pack_release');
    expect(notices[0].recipient).toBe('owner@example.test');
    expect(notices[0].payload.body).toContain('Calm bot');
    expect(notices[0].payload.body).toContain('1 added, 0 removed');

    // The chatbot's stored version follows in the background.
    for (let i = 0; i < 50; i += 1) {
      const [row] = await dataSource.query(
        `SELECT safety_pack_version FROM chatbots WHERE id = $1`,
        [bot],
      );
      if (row.safety_pack_version === code.version + 1) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const [row] = await dataSource.query(
      `SELECT safety_pack_version FROM chatbots WHERE id = $1`,
      [bot],
    );
    expect(row.safety_pack_version).toBe(code.version + 1);
  });

  it('rolls back to the previous release in one step and tells the owner', async () => {
    const draft = await tested('Rule to roll back.');
    await service.release(draft.id, 1);
    const restored = await service.rollback(PACK, 2, 'bad wording');
    expect(restored.version).toBe(code.version);
    expect(restored.current).toBe(true);
    expect(packFor(PACK)?.rules).not.toContain('Rule to roll back.');
    const [gone] = await dataSource.query(
      `SELECT status, rolled_back_by, rolled_back_at FROM safety_pack_releases WHERE id = $1`,
      [draft.id],
    );
    expect(gone.status).toBe('rolled_back');
    expect(gone.rolled_back_by).toBe(2);
    expect(gone.rolled_back_at).not.toBeNull();
    const kinds = (
      await dataSource.query(`SELECT kind FROM alert_outbox ORDER BY kind`)
    ).map((r: { kind: string }) => r.kind);
    expect(kinds).toEqual(['safety_pack_release', 'safety_pack_rollback']);
    // The seed has nothing before it.
    await expect(service.rollback(PACK, 2)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('serves the code packs with the kill switch off', async () => {
    const draft = await tested('Switched-off rule.');
    await service.release(draft.id, 1);
    switches.ASSISTANT_PACK_RELEASES_ENABLED = 'false';
    await service.refresh();
    expect(packFor(PACK)).toBe(code);
  });
});
