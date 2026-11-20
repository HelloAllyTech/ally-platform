import { DataSource } from 'typeorm';
import {
  closeTestDataSource,
  describePg,
  openTestDataSource,
  resetTables,
  seedChatbot,
} from 'src/whatsapp/shared-store/test/shared-store.pg';
import { ListDefinitionsService } from '../../../chatbot/lists/list-definitions.service';
import { LIST_ENTITIES } from '../../../chatbot/lists/list-entities';
import { ListOwnerService } from '../../../chatbot/lists/list-owner.service';
import { ListRecordsService } from '../../../chatbot/lists/list-records.service';
import { ListConsentService } from '../../../chatbot/agent-tools/list-consent.service';
import { ListToolsService } from '../../../chatbot/agent-tools/list-tools.service';
import { memoryRedis } from '../../../chatbot/agent-tools/test/agent-tools.fakes';
import { TEMPLATES } from '../../../chatbot/templates/templates';
import { ChatbotCheckupCase } from '../../entity/chatbot-checkup.entity';
import { ChatbotTemplateInstall } from '../../entity/chatbot-template-install.entity';
import { SafetyPackId } from '../../enum/bot-draft.enum';
import { TemplateService } from '../template.service';

/**
 * Installing a use-case template on real Postgres (T1): one transaction, existing lists kept,
 * the pack never weaker, nothing published, and the starter checkup's questions in place.
 */
describePg('Use-case templates: install (Postgres)', () => {
  let ds: DataSource;
  let owner: ListOwnerService;
  let records: ListRecordsService;
  let service: TemplateService;
  let bot: string;

  const settings = {
    getForChatbot: async (chatbot: { settings?: Record<string, unknown> }) =>
      chatbot.settings ?? {},
  };
  const access = {
    assert: jest.fn(async () => ({ chatbot: {}, role: 'owner' })),
  };
  const drafts = {
    findById: jest.fn(),
    update: jest.fn(),
    setSafety: jest.fn(),
  };
  const publish = { ownerNotes: jest.fn() };

  const row = async (id = bot) => {
    const [r] = await ds.query(
      `SELECT status, settings, safety_pack AS "safetyPack", rules FROM chatbots WHERE id = $1`,
      [id],
    );
    return r;
  };
  const keys = async (id = bot) =>
    (
      await ds.query(
        `SELECT key FROM collections WHERE chatbot_id = $1 AND deleted_at IS NULL ORDER BY key`,
        [id],
      )
    ).map((r: { key: string }) => r.key);

  beforeAll(async () => {
    ds = await openTestDataSource([
      ...LIST_ENTITIES,
      ChatbotCheckupCase,
      ChatbotTemplateInstall,
    ]);
    const definitions = new ListDefinitionsService(ds);
    records = new ListRecordsService(ds);
    owner = new ListOwnerService(ds, definitions, records, settings as never);
    service = new TemplateService(
      ds,
      access as never,
      owner,
      records,
      drafts as never,
      publish as never,
    );
  });
  afterAll(async () => closeTestDataSource(ds));
  beforeEach(async () => {
    await resetTables(ds);
    await ds.query(
      `TRUNCATE chatbot_template_installs, chatbot_checkup_cases CASCADE`,
    );
    bot = await seedChatbot(ds, 'T1 bot');
    await ds.query(`UPDATE chatbots SET status = 'draft' WHERE id = $1`, [bot]);
  });

  it.each(TEMPLATES.map((t) => [t.id] as const))(
    '%s installs on a fresh assistant, with its starter checkup',
    async (id) => {
      const t = TEMPLATES.find((x) => x.id === id)!;
      const answers = Object.fromEntries(
        t.setup.map((q) => [q.key, q.kind === 'yes_no' ? true : undefined]),
      );
      const result = await service.installOnAssistant(bot, id, answers);
      const expectedLists = t.lists.filter(
        (l) => !l.only_if || answers[l.only_if] === true,
      );
      expect(await keys()).toEqual(expectedLists.map((l) => l.key).sort());
      expect(result.skipped).toEqual([]);

      const stored = await row();
      // Never publishes: the plan's published-assistant limit never moves (CR1).
      expect(stored.status).toBe('draft');
      for (const use of expectedLists) {
        expect(stored.settings.abilities[`find_${use.key}`]).toBe(use.find);
        expect(stored.settings.abilities[`create_${use.key}`]).toBe(use.create);
        expect(stored.settings.abilities[`update_${use.key}`]).toBe(use.update);
        const [list] = await ds.query(
          `SELECT settings FROM collections WHERE chatbot_id = $1 AND key = $2`,
          [bot, use.key],
        );
        expect(list.settings.instruction).toBe(use.line);
      }
      if (t.hand_over)
        expect(stored.settings.abilities.hand_over).toBe('do_it');
      if (t.pack) expect(stored.safetyPack).toBe(t.pack);

      const cases = await ds.query(
        `SELECT question, origin, confirmed, external_id FROM chatbot_checkup_cases WHERE chatbot_id = $1`,
        [bot],
      );
      expect(cases.length).toBeGreaterThanOrEqual(5);
      expect(cases.every((c: { confirmed: boolean }) => c.confirmed)).toBe(
        true,
      );
      expect(result.checkups).toBe(cases.length);

      const [install] = await ds.query(
        `SELECT template_id FROM chatbot_template_installs WHERE chatbot_id = $1`,
        [bot],
      );
      expect(install.template_id).toBe(id);
      expect(await service.originOf(bot)).toEqual({ id, name: t.name });
    },
  );

  it('writes the owner’s answers as entries, and examples only for what was skipped', async () => {
    await service.installOnAssistant(bot, 'salon', {
      prices: 'Haircut - 300\nFacial - 1200',
    });
    const rows = await ds.query(
      `SELECT r.data, r.created_by FROM collection_records r JOIN collections c ON c.id = r.collection_id
        WHERE c.chatbot_id = $1 AND c.key = 'price_list' ORDER BY r.data->>'service'`,
      [bot],
    );
    expect(
      rows.map((r: { data: { service: string } }) => r.data.service),
    ).toEqual(['Facial', 'Haircut']);
    expect(
      rows.every(
        (r: { created_by: { example?: boolean } }) => !r.created_by.example,
      ),
    ).toBe(true);
    expect((await service.examplesLeft(bot)).total).toBe(0);

    const other = await seedChatbot(ds, 'Skipped');
    await service.installOnAssistant(other, 'salon', {});
    expect(await service.examplesLeft(other)).toEqual({
      total: 2,
      lists: [{ key: 'price_list', name: 'Price list', count: 2 }],
    });
  });

  it('an example the owner changes is theirs, and stops counting', async () => {
    await service.installOnAssistant(bot, 'salon', {});
    const [first] = await ds.query(
      `SELECT r.id, r.version FROM collection_records r JOIN collections c ON c.id = r.collection_id
        WHERE c.chatbot_id = $1 AND c.key = 'price_list' LIMIT 1`,
      [bot],
    );
    await records.update(
      bot,
      'price_list',
      { kind: 'user', userId: 1 },
      first.id,
      { price: 450 },
      first.version,
    );
    expect((await service.examplesLeft(bot)).total).toBe(1);
  });

  it('on an existing assistant, keeps its lists exactly as they are and names them', async () => {
    await owner.install({ id: bot, settings: {} }, 'callback_requests');
    await owner.setAbilities(
      bot,
      'callback_requests',
      { create: 'never' },
      'My own line',
    );
    const result = await service.installOnAssistant(bot, 'clinic', {});
    expect(result.skipped).toEqual(['Callback requests']);
    expect(result.added).toEqual(['Slots', 'Appointments']);
    const stored = await row();
    expect(stored.settings.abilities.create_callback_requests).toBe('never');
    const [list] = await ds.query(
      `SELECT settings FROM collections WHERE chatbot_id = $1 AND key = 'callback_requests'`,
      [bot],
    );
    expect(list.settings.instruction).toBe('My own line');
  });

  it('never weakens the pack: a stricter one stays, and the owner is told', async () => {
    await ds.query(
      `UPDATE chatbots SET safety_pack = 'mental_health' WHERE id = $1`,
      [bot],
    );
    const result = await service.installOnAssistant(bot, 'finance_legal', {});
    expect(result.pack).toMatchObject({ outcome: 'kept' });
    expect((await row()).safetyPack).toBe('mental_health');
  });

  it('never swaps one care pack for another', async () => {
    await ds.query(`UPDATE chatbots SET safety_pack = 'minors' WHERE id = $1`, [
      bot,
    ]);
    const result = await service.installOnAssistant(bot, 'clinic', {});
    expect(result.pack.outcome).toBe('cant_combine');
    expect((await row()).safetyPack).toBe('minors');
  });

  it('raises a less strict pack, and records the change', async () => {
    await ds.query(
      `UPDATE chatbots SET safety_pack = 'standard' WHERE id = $1`,
      [bot],
    );
    const result = await service.installOnAssistant(bot, 'helpline', {
      helpline: '1800-123-4567, open 24 hours',
    });
    expect(result.pack).toMatchObject({ outcome: 'raised' });
    const stored = await row();
    expect(stored.safetyPack).toBe(SafetyPackId.MENTAL_HEALTH);
    expect(stored.rules.packChange).toMatchObject({
      from: 'standard',
      to: 'mental_health',
      lessStrict: false,
    });
    // The crisis reply reads this.
    expect(stored.settings.helplineNumbers).toBe(
      '1800-123-4567, open 24 hours',
    );
  });

  it('keeps an existing assistant’s own helpline number and memory', async () => {
    await ds.query(
      `UPDATE chatbots SET settings = '{"helplineNumbers":"Ours: 1800-000-0000","memory":{"on":true}}' WHERE id = $1`,
      [bot],
    );
    await service.installOnAssistant(bot, 'helpline', {
      helpline: '1800-123-4567',
    });
    const stored = await row();
    expect(stored.settings.helplineNumbers).toBe('Ours: 1800-000-0000');
    expect(stored.settings.memory.on).toBe(true);
  });

  it('is all or nothing: a failure part-way leaves no lists, entries or questions', async () => {
    const spy = jest
      .spyOn(records, 'create')
      .mockRejectedValueOnce(new Error('boom'));
    await expect(service.installOnAssistant(bot, 'salon', {})).rejects.toThrow(
      'boom',
    );
    spy.mockRestore();
    expect(await keys()).toEqual([]);
    const [{ count }] = await ds.query(
      `SELECT count(*)::int AS count FROM chatbot_checkup_cases WHERE chatbot_id = $1`,
      [bot],
    );
    expect(count).toBe(0);
    expect((await row()).settings?.abilities?.hand_over).toBeUndefined();
  });

  it('installing twice adds no duplicate questions or lists', async () => {
    await service.installOnAssistant(bot, 'real_estate', {});
    const again = await service.installOnAssistant(bot, 'real_estate', {});
    expect(again.added).toEqual([]);
    expect(again.checkups).toBe(0);
  });

  it('keeps H1’s rule: a template’s Do it still needs the person’s yes before anything is saved', async () => {
    await service.installOnAssistant(bot, 'helpline', {});
    expect((await row()).settings.abilities.create_callback_requests).toBe(
      'do_it',
    );
    const contactId = (
      await ds.query(
        `INSERT INTO chatbot_contacts (chatbot_id, display_name) VALUES ($1, 'Asha') RETURNING id`,
        [bot],
      )
    )[0].id;
    const tools = new ListToolsService(
      ds,
      new ListDefinitionsService(ds),
      records,
      new ListConsentService(memoryRedis() as never),
    );
    const tool = (await tools.resolve(bot, 'create_callback_requests'))!;
    const outcome = await tool.run(
      { chatbotId: bot, conversationId: 'conv-t1', runId: 'run-t1', contactId },
      tool.parse({ phone: '9876543210', preferred_time: 'evening' }),
    );
    expect(outcome).toMatchObject({ ok: false, error: 'needs_confirmation' });
    const [{ count }] = await ds.query(
      `SELECT count(*)::int AS count FROM collection_records r JOIN collections c ON c.id = r.collection_id
        WHERE c.chatbot_id = $1 AND c.key = 'callback_requests'`,
      [bot],
    );
    expect(count).toBe(0);
  });
});
