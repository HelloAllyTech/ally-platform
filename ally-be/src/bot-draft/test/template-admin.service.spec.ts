import {
  TEMPLATES,
  type UseCaseTemplate,
} from '../../chatbot/templates/templates';
import type { AssistantTemplate } from '../entity/assistant-template.entity';
import { TemplateAdminService } from '../templates/template-admin.service';
import {
  mergeTemplates,
  TemplateRegistryService,
} from '../templates/template-registry.service';

type Where = Partial<
  Pick<AssistantTemplate, 'templateKey' | 'status' | 'version'>
>;

/** A table of rows with just the repository calls the services make. */
function fakeRepo() {
  const rows: AssistantTemplate[] = [];
  const matches = (r: AssistantTemplate, w: Where = {}) =>
    Object.entries(w).every(([k, v]) => (r as never)[k] === v);
  let n = 0;
  return {
    rows,
    create: (x: Partial<AssistantTemplate>) =>
      ({
        id: `row-${++n}`,
        createdAt: new Date('2026-11-25T00:00:00Z'),
        updatedAt: new Date('2026-11-25T00:00:00Z'),
        ...x,
      }) as AssistantTemplate,
    find: async ({ where }: { where?: Where; order?: unknown } = {}) =>
      rows
        .filter((r) => matches(r, where))
        .sort((a, b) => b.version - a.version),
    findOne: async ({ where }: { where: Where }) =>
      rows.find((r) => matches(r, where)) ?? null,
    save: async (r: AssistantTemplate) => {
      if (!rows.includes(r)) rows.push(r);
      return r;
    },
    update: async (where: Where, patch: Partial<AssistantTemplate>) => {
      rows
        .filter((r) => matches(r, where))
        .forEach((r) => Object.assign(r, patch));
    },
    delete: async ({ id }: { id: string }) => {
      const i = rows.findIndex((r) => r.id === id);
      if (i >= 0) rows.splice(i, 1);
    },
  };
}

function build() {
  const repo = fakeRepo();
  const manager = {
    getRepository: () => repo,
    query: async () => [],
  };
  const dataSource = {
    transaction: async <T>(fn: (m: typeof manager) => Promise<T>) =>
      fn(manager),
    query: async () => [{ template_id: 'clinic', n: 3 }],
  };
  const registry = new TemplateRegistryService(repo as never);
  const admin = new TemplateAdminService(
    repo as never,
    dataSource as never,
    registry,
  );
  return { repo, admin, registry };
}

const builtIn = (id: string) => TEMPLATES.find((t) => t.id === id)!;

/** A valid new template: the clinic one under its own key and name. */
const valid = (key: string): UseCaseTemplate => ({
  ...structuredClone(builtIn('clinic')),
  id: key,
  name: 'Dental clinic',
});

describe('TemplateAdminService', () => {
  it('lists the 17 built-ins with their install counts, then staff-made ones', async () => {
    const { admin } = build();
    await admin.createDraft({ key: 'dental', name: 'Dental' });
    const { templates } = await admin.list();
    expect(templates).toHaveLength(TEMPLATES.length + 1);
    const clinic = templates.find((t) => t.key === 'clinic')!;
    expect(clinic).toMatchObject({
      origin: 'built_in',
      state: 'built_in',
      installs: 3,
      live_version: null,
    });
    expect(templates[templates.length - 1]).toMatchObject({
      key: 'dental',
      origin: 'custom',
      state: 'unpublished',
      draft_version: 1,
    });
  });

  it('starts a blank draft that cannot be published until it is filled in', async () => {
    const { admin } = build();
    const draft = await admin.createDraft({ key: 'dental', name: 'Dental' });
    expect(draft.status).toBe('draft');
    expect(draft.issues.some((i) => i.severity === 'error')).toBe(true);
    await expect(admin.publish('dental')).rejects.toMatchObject({
      response: { errorCode: 'template_not_ready' },
    });
  });

  it('refuses a second open draft, and a blank draft over a built-in key', async () => {
    const { admin } = build();
    await admin.createDraft({ key: 'clinic', from: { key: 'clinic' } });
    await expect(
      admin.createDraft({ key: 'clinic', from: { key: 'clinic' } }),
    ).rejects.toMatchObject({ response: { errorCode: 'draft_exists' } });
    await expect(
      admin.createDraft({ key: 'clinic', name: 'Mine' }),
    ).rejects.toMatchObject({ response: { errorCode: 'template_key_taken' } });
  });

  it('refuses a bad key, and copying one template onto another’s key', async () => {
    const { admin } = build();
    await expect(
      admin.createDraft({ key: 'Bad Key', name: 'x' }),
    ).rejects.toMatchObject({
      response: { errorCode: 'template_key_invalid' },
    });
    await expect(
      admin.createDraft({ key: 'salon', from: { key: 'clinic' } }),
    ).rejects.toMatchObject({ response: { errorCode: 'template_key_taken' } });
  });

  it('editing a built-in starts from its code and, once published, overrides it', async () => {
    const { admin, registry } = build();
    const draft = await admin.createDraft({
      key: 'clinic',
      from: { key: 'clinic' },
    });
    expect(draft.manifest.name).toBe(builtIn('clinic').name);
    expect(draft.issues.filter((i) => i.severity === 'error')).toEqual([]);

    const edited = {
      ...draft.manifest,
      one_liner: 'Books visits at our two clinics.',
    };
    await admin.saveDraft('clinic', edited, 'New one-liner');
    const published = await admin.publish('clinic');
    expect(published).toMatchObject({ version: 1, status: 'published' });

    const live = (await registry.byId('clinic'))!;
    expect(live).toMatchObject({
      source: 'managed',
      version: 1,
      overrides: true,
    });
    expect(live.template.one_liner).toBe('Books visits at our two clinics.');
    // Same position as the built-in, not appended.
    expect((await registry.all()).findIndex((t) => t.id === 'clinic')).toBe(
      TEMPLATES.findIndex((t) => t.id === 'clinic'),
    );
  });

  it('publishing a second version retires the first; only one is live', async () => {
    const { admin, repo, registry } = build();
    await admin.createDraft({ key: 'clinic', from: { key: 'clinic' } });
    await admin.publish('clinic');
    await admin.createDraft({ key: 'clinic', from: { key: 'clinic' } });
    await admin.publish('clinic');
    const states = repo.rows
      .filter((r) => r.templateKey === 'clinic')
      .sort((a, b) => a.version - b.version)
      .map((r) => r.status);
    expect(states).toEqual(['retired', 'published']);
    expect((await registry.byId('clinic'))!.version).toBe(2);
  });

  it('unpublishing a built-in’s override brings the code version back', async () => {
    const { admin, registry } = build();
    await admin.createDraft({ key: 'clinic', from: { key: 'clinic' } });
    await admin.publish('clinic');
    await admin.unpublish('clinic');
    const back = (await registry.byId('clinic'))!;
    expect(back).toMatchObject({ source: 'code', version: null });
    await expect(admin.unpublish('clinic')).rejects.toMatchObject({
      response: { errorCode: 'not_published' },
    });
  });

  it('a new staff-made template joins the catalogue when published and leaves when unpublished', async () => {
    const { admin, registry } = build();
    const draft = await admin.createDraft({
      key: 'dental_clinic',
      name: 'Dental clinic',
      from: { key: 'clinic' },
    });
    expect(draft.manifest).toMatchObject({
      id: 'dental_clinic',
      name: 'Dental clinic',
    });
    await admin.publish('dental_clinic');
    expect((await registry.all()).map((t) => t.id)).toEqual([
      ...TEMPLATES.map((t) => t.id),
      'dental_clinic',
    ]);
    await admin.unpublish('dental_clinic');
    expect((await registry.all()).map((t) => t.id)).toEqual(
      TEMPLATES.map((t) => t.id),
    );
  });

  it('a staff-made template that was taken down still lists, and can be edited again', async () => {
    const { admin } = build();
    await admin.createDraft({
      key: 'dental_clinic',
      name: 'Dental clinic',
      from: { key: 'clinic' },
    });
    await admin.publish('dental_clinic');
    await admin.unpublish('dental_clinic');

    const { templates } = await admin.list();
    expect(templates.find((t) => t.key === 'dental_clinic')).toMatchObject({
      name: 'Dental clinic',
      origin: 'custom',
      state: 'unpublished',
      live_version: null,
      draft_version: null,
    });
    const detail = await admin.get('dental_clinic');
    expect(detail.live).toBeNull();
    expect(detail.last_retired?.manifest.name).toBe('Dental clinic');

    // “Edit this template” on it starts a new draft from the newest version.
    const again = await admin.createDraft({
      key: 'dental_clinic',
      from: { key: 'dental_clinic' },
    });
    expect(again).toMatchObject({ version: 2, status: 'draft' });
    expect(again.manifest.name).toBe('Dental clinic');
  });

  it('saving keeps only a template’s own fields and forces its key', async () => {
    const { admin } = build();
    await admin.createDraft({ key: 'dental', name: 'Dental' });
    const saved = await admin.saveDraft('dental', {
      ...valid('someone_elses'),
      injected: 'x',
    });
    expect(saved.manifest.id).toBe('dental');
    expect(saved.manifest).not.toHaveProperty('injected');
  });

  it('saves a half-finished draft and returns its problems instead of refusing', async () => {
    const { admin } = build();
    await admin.createDraft({ key: 'dental', name: 'Dental' });
    const saved = await admin.saveDraft('dental', { name: 'Half done' });
    expect(saved.issues.some((i) => i.severity === 'error')).toBe(true);
  });

  it('restores an older version into a new draft, and keeps history', async () => {
    const { admin } = build();
    await admin.createDraft({ key: 'clinic', from: { key: 'clinic' } });
    await admin.saveDraft('clinic', {
      ...builtIn('clinic'),
      name: 'Clinic v1',
    });
    await admin.publish('clinic');
    await admin.createDraft({ key: 'clinic', from: { key: 'clinic' } });
    await admin.saveDraft('clinic', {
      ...builtIn('clinic'),
      name: 'Clinic v2',
    });
    await admin.publish('clinic');

    const restored = await admin.restore('clinic', 1);
    expect(restored).toMatchObject({ version: 3, status: 'draft' });
    expect(restored.manifest.name).toBe('Clinic v1');
    const detail = await admin.get('clinic');
    expect(detail.versions.map((v) => `${v.version}:${v.status}`)).toEqual([
      '3:draft',
      '2:published',
      '1:retired',
    ]);
  });

  it('discarding a draft removes only the draft', async () => {
    const { admin } = build();
    await admin.createDraft({ key: 'clinic', from: { key: 'clinic' } });
    await admin.publish('clinic');
    await admin.createDraft({ key: 'clinic', from: { key: 'clinic' } });
    await admin.discardDraft('clinic');
    const detail = await admin.get('clinic');
    expect(detail.draft).toBeNull();
    expect(detail.live?.version).toBe(1);
  });

  it('404s on a template that does not exist', async () => {
    const { admin } = build();
    await expect(admin.get('nope')).rejects.toMatchObject({
      response: { errorCode: 'template_not_found' },
    });
    await expect(admin.saveDraft('nope', {})).rejects.toMatchObject({
      response: { errorCode: 'no_draft' },
    });
  });

  it('tells the editor what lists, packs and purposes it can offer', () => {
    const { admin } = build();
    const meta = admin.meta();
    expect(meta.lists.map((l) => l.key)).toEqual(
      expect.arrayContaining(['services', 'appointments']),
    );
    expect(meta.packs.map((p) => p.id)).toContain('mental_health');
    expect(meta.purposes).toHaveLength(5);
    expect(meta.groups.map((g) => g.id)).toEqual([
      'organisations',
      'businesses',
    ]);
  });
});

describe('mergeTemplates', () => {
  it('replaces a built-in in place and appends new keys oldest first', () => {
    const a = { ...structuredClone(builtIn('clinic')), name: 'Clinic edited' };
    const x = { ...structuredClone(builtIn('salon')), id: 'x_new' };
    const y = { ...structuredClone(builtIn('salon')), id: 'y_new' };
    const merged = mergeTemplates(TEMPLATES, [
      { manifest: y, version: 1, publishedAt: new Date('2026-11-02') },
      { manifest: a, version: 4, publishedAt: new Date('2026-11-03') },
      { manifest: x, version: 1, publishedAt: new Date('2026-11-01') },
    ]);
    expect(merged.map((m) => m.template.id)).toEqual([
      ...TEMPLATES.map((t) => t.id),
      'x_new',
      'y_new',
    ]);
    const clinic = merged.find((m) => m.template.id === 'clinic')!;
    expect(clinic).toMatchObject({
      source: 'managed',
      version: 4,
      overrides: true,
    });
    expect(merged.find((m) => m.template.id === 'salon')!.source).toBe('code');
  });
});

describe('TemplateRegistryService', () => {
  it('serves the built-ins when the table cannot be read, and retries soon', async () => {
    const find = jest
      .fn()
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValue([]);
    const registry = new TemplateRegistryService({ find } as never);
    expect(await registry.all()).toHaveLength(TEMPLATES.length);
    expect(find).toHaveBeenCalledTimes(1);
    registry.invalidate();
    await registry.all();
    expect(find).toHaveBeenCalledTimes(2);
  });

  it('skips a published version that no longer passes the checks', async () => {
    const broken = {
      ...structuredClone(builtIn('clinic')),
      instructions: 'no placeholder here at all, sorry',
    };
    const registry = new TemplateRegistryService({
      find: async () => [
        {
          templateKey: 'clinic',
          version: 2,
          manifest: broken,
          publishedAt: new Date(),
          status: 'published',
        },
      ],
    } as never);
    expect((await registry.byId('clinic'))!.source).toBe('code');
  });

  it('caches for a moment so a catalogue request does not hit the table every time', async () => {
    const find = jest.fn().mockResolvedValue([]);
    const registry = new TemplateRegistryService({ find } as never);
    await registry.all();
    await registry.all();
    expect(find).toHaveBeenCalledTimes(1);
  });
});
