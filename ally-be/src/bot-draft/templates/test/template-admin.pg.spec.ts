import { DataSource } from 'typeorm';
import { TEMPLATES } from '../../../chatbot/templates/templates';
import {
  closeTestDataSource,
  describePg,
  openTestDataSource,
} from '../../../whatsapp/shared-store/test/shared-store.pg';
import { CreateAssistantTemplates1988100000000 } from '../../../database/migrations/1988100000000-CreateAssistantTemplates';
import { AssistantTemplate } from '../../entity/assistant-template.entity';
import { TemplateAdminService } from '../template-admin.service';
import { TemplateRegistryService } from '../template-registry.service';

/**
 * Staff-managed templates against real Postgres: the migration's partial unique indexes (one open
 * draft and one published version per key), the advisory lock, and the whole draft → publish →
 * retire life. Runs only with CHATBOT_STORE_TEST_DB (see `shared-store.pg.ts`).
 */
describePg('assistant_templates (Postgres)', () => {
  let ds: DataSource;
  let admin: TemplateAdminService;
  let registry: TemplateRegistryService;

  beforeAll(async () => {
    ds = await openTestDataSource([AssistantTemplate]);
    // This table has no foreign keys: build it from the migration itself so its SQL is tested.
    await ds.query(`DROP TABLE IF EXISTS "assistant_templates"`);
    const runner = ds.createQueryRunner();
    await new CreateAssistantTemplates1988100000000().up(runner);
    await runner.release();
    const repo = ds.getRepository(AssistantTemplate);
    registry = new TemplateRegistryService(repo);
    admin = new TemplateAdminService(repo, ds, registry);
  });
  afterAll(async () => closeTestDataSource(ds));
  beforeEach(async () => {
    await ds.query(`TRUNCATE assistant_templates`);
    registry.invalidate();
  });

  const row = (over: Record<string, unknown>) =>
    ds.query(
      `INSERT INTO assistant_templates (template_key, version, status, manifest) VALUES ($1, $2, $3, '{}')`,
      [over.key, over.version, over.status],
    );

  it('allows one open draft and one published version per key, and many retired ones', async () => {
    await row({ key: 'k', version: 1, status: 'retired' });
    await row({ key: 'k', version: 2, status: 'retired' });
    await row({ key: 'k', version: 3, status: 'published' });
    await row({ key: 'k', version: 4, status: 'draft' });
    await expect(
      row({ key: 'k', version: 5, status: 'draft' }),
    ).rejects.toThrow(/uq_assistant_templates_draft/);
    await expect(
      row({ key: 'k', version: 6, status: 'published' }),
    ).rejects.toThrow(/uq_assistant_templates_published/);
    await expect(
      row({ key: 'k', version: 1, status: 'retired' }),
    ).rejects.toThrow(/UQ_assistant_templates_key_version/);
    // …but another key is independent.
    await row({ key: 'other', version: 1, status: 'draft' });
  });

  it('refuses a status the lifecycle does not have', async () => {
    await expect(row({ key: 'k', version: 1, status: 'live' })).rejects.toThrow(
      /CHK_assistant_templates_status/,
    );
  });

  it('runs a built-in through edit → publish → edit → publish → take down', async () => {
    const first = await admin.createDraft({
      key: 'clinic',
      from: { key: 'clinic' },
    });
    await admin.saveDraft('clinic', {
      ...first.manifest,
      name: 'Clinic, edited',
    });
    await admin.publish('clinic', 'First edit');
    expect((await registry.byId('clinic'))!.template.name).toBe(
      'Clinic, edited',
    );

    const second = await admin.createDraft({
      key: 'clinic',
      from: { key: 'clinic' },
    });
    expect(second.version).toBe(2);
    expect(second.manifest.name).toBe('Clinic, edited'); // copies what owners see
    await admin.saveDraft('clinic', {
      ...second.manifest,
      name: 'Clinic, again',
    });
    await admin.publish('clinic');

    const detail = await admin.get('clinic');
    expect(detail.versions.map((v) => `${v.version}:${v.status}`)).toEqual([
      '2:published',
      '1:retired',
    ]);
    expect(detail.versions[1].note).toBe('First edit');

    await admin.unpublish('clinic');
    registry.invalidate();
    expect((await registry.byId('clinic'))!.template.name).toBe(
      TEMPLATES.find((t) => t.id === 'clinic')!.name,
    );
  });

  it('two people starting a draft at once get one draft and one clear refusal', async () => {
    const results = await Promise.allSettled([
      admin.createDraft({ key: 'clinic', from: { key: 'clinic' } }),
      admin.createDraft({ key: 'clinic', from: { key: 'clinic' } }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const refused = results.find((r) => r.status === 'rejected') as
      | PromiseRejectedResult
      | undefined;
    expect(refused?.reason?.response?.errorCode).toBe('draft_exists');
  });

  it('two people publishing at once leave exactly one live version', async () => {
    await admin.createDraft({ key: 'clinic', from: { key: 'clinic' } });
    const results = await Promise.allSettled([
      admin.publish('clinic'),
      admin.publish('clinic'),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const live = await ds.query(
      `SELECT count(*)::int AS n FROM assistant_templates WHERE template_key = 'clinic' AND status = 'published'`,
    );
    expect(live[0].n).toBe(1);
  });

  it('a template made by staff appears with its own key and leaves when taken down', async () => {
    await admin.createDraft({
      key: 'dental_clinic',
      name: 'Dental clinic',
      from: { key: 'clinic' },
    });
    await admin.publish('dental_clinic');
    expect((await registry.all()).map((t) => t.id)).toContain('dental_clinic');
    const { templates } = await admin.list();
    expect(templates.find((t) => t.key === 'dental_clinic')).toMatchObject({
      origin: 'custom',
      state: 'published',
      live_version: 1,
    });
    await admin.unpublish('dental_clinic');
    registry.invalidate();
    expect((await registry.all()).map((t) => t.id)).not.toContain(
      'dental_clinic',
    );
  });
});
