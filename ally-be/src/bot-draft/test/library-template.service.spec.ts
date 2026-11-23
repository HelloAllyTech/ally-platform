import { ExecutionManager } from '../../common/execution/execution-manager';
import { templateById } from '../../chatbot/templates/templates';
import { TEMPLATE_KNOWLEDGE_TAG } from '../../knowledge-base/constants/template-knowledge';
import { BotDraftService } from '../service/bot-draft.service';
import {
  LIBRARY_TEMPLATES,
  libraryTemplateById,
} from '../templates/library-templates';
import {
  chosenLanguages,
  LibraryTemplateService,
} from '../templates/library-template.service';

function blankDraft(over: Record<string, unknown> = {}) {
  return {
    id: 'draft-1',
    chatbotId: 'bot-1',
    blank: true,
    source: {},
    events: [],
    industry: null,
    draftConfig: BotDraftService.defaultDraft('Your assistant'),
    ...over,
  } as never;
}

function harness(row: { installed?: boolean; documents?: boolean } = {}) {
  let current = blankDraft() as Record<string, unknown>;
  const drafts = {
    touch: jest.fn(async () => undefined),
    update: jest.fn(async (d: object, patch: object) => {
      current = { ...d, ...patch };
      return current;
    }),
    setSafety: jest.fn(async (d: object) => d),
    addKnowledgeDocument: jest.fn(async () => undefined),
    attachDocument: jest.fn(async () => undefined),
    findById: jest.fn(async () => current),
  };
  const templates = {
    installOnDraft: jest.fn(async (d: object) => ({
      draft: d,
      result: { added: ['Callback requests'], skipped: [] },
    })),
  };
  let n = 0;
  const knowledge = {
    createForChatbot: jest.fn(async () => ({ id: `doc-${++n}` })),
  };
  const saved: unknown[] = [];
  const repo = {
    create: (v: unknown) => v,
    save: jest.fn(async (v: unknown) => saved.push(v)),
  };
  const dataSource = {
    query: jest.fn(async (sql: string) =>
      sql.includes('EXISTS')
        ? [{ installed: !!row.installed, documents: !!row.documents }]
        : [{ pending: 3 }],
    ),
    getRepository: () => repo,
  };
  const service = new LibraryTemplateService(
    drafts as never,
    templates as never,
    knowledge as never,
    dataSource as never,
  );
  const ctx = (over: Record<string, unknown> = {}) => ({
    draft: blankDraft(over),
    chatbot: { id: 'bot-1' } as never,
    live: false,
  });
  return { service, drafts, templates, knowledge, saved, ctx };
}

describe('Ally template chatbots', () => {
  beforeEach(() =>
    jest.spyOn(ExecutionManager, 'getUserId').mockReturnValue('7' as never),
  );
  afterEach(() => jest.restoreAllMocks());

  it('has three templates, each built on a real use-case template and with knowledge', () => {
    expect(LIBRARY_TEMPLATES.map((t) => t.id)).toEqual([
      'lib-helpline-front-door',
      'lib-clinic-front-desk',
      'lib-community-information',
    ]);
    for (const t of LIBRARY_TEMPLATES) {
      expect(templateById(t.base)).toBeDefined();
      expect(t.documents.length).toBeGreaterThan(0);
      expect(t.rules.length).toBeLessThanOrEqual(20);
      // No country's helpline numbers in the defaults (R6).
      const all = JSON.stringify(t);
      expect(all).not.toMatch(/\b(112|988|999|911|14416|Tele-?MANAS)\b/i);
    }
  });

  it('offers setup questions as form fields, with the name first', () => {
    const h = harness();
    const card = h.service.card(
      libraryTemplateById('lib-helpline-front-door')!,
    );
    expect(card.fields[0]).toMatchObject({ key: 'name', required: true });
    expect(card.fields.map((f) => f.key)).toEqual(
      expect.arrayContaining(['helpline']),
    );
  });

  it('applies to a blank chatbot: persona, rules and knowledge copied, indexing reported', async () => {
    const h = harness();
    const result = await h.service.apply(h.ctx(), 'lib-helpline-front-door', {
      name: 'Calm Line',
      helpline: '0123 456 789, 24 hours',
    });
    expect(result.applied).toBe(true);
    expect(result.sourcesIndexing).toBe(3);
    expect(h.templates.installOnDraft).toHaveBeenCalledWith(
      expect.anything(),
      'helpline',
      { helpline: '0123 456 789, 24 hours' },
    );
    const config = (
      result.draft as unknown as { draftConfig: Record<string, unknown> }
    ).draftConfig;
    expect(config.name).toBe('Calm Line');
    expect(String(config.instructions)).toContain('Calm Line');
    expect(config.extraNever).toEqual(
      expect.arrayContaining([
        "Don't give advice about medicines, diagnoses or treatment.",
      ]),
    );
    // Each document is the chatbot's own, tagged so its first indexing is Ally's cost.
    expect(h.knowledge.createForChatbot).toHaveBeenCalledTimes(3);
    for (const call of h.knowledge.createForChatbot.mock.calls as unknown[][]) {
      expect(call[0]).toBe('bot-1');
      expect((call[1] as { tags: string[] }).tags).toContain(
        TEMPLATE_KNOWLEDGE_TAG,
      );
    }
    expect(h.drafts.attachDocument).toHaveBeenCalledTimes(3);
    expect(h.saved).toEqual([
      expect.objectContaining({
        templateId: 'lib-helpline-front-door',
        templateVersion: 1,
        templateKind: 'library',
      }),
    ]);
    expect(h.drafts.touch).toHaveBeenCalledWith('draft-1');
  });

  it.each([
    ['a chatbot not created blank', { blank: false }, {}],
    [
      'one already set up from a template',
      { source: { template: { id: 'x' } } },
      {},
    ],
    ['one with an edit', { events: [{ kind: 'patch' }] }, {}],
    ['one with documents', {}, { documents: true }],
    ['one with a template installed', {}, { installed: true }],
  ])('refuses %s with not_blank', async (_label, over, row) => {
    const h = harness(row);
    await expect(
      h.service.apply(h.ctx(over), 'lib-helpline-front-door', {}),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ errorCode: 'not_blank' }),
    });
    expect(h.knowledge.createForChatbot).not.toHaveBeenCalled();
    expect(h.templates.installOnDraft).not.toHaveBeenCalled();
  });

  it('refuses a live chatbot with not_blank', async () => {
    const h = harness();
    await expect(
      h.service.apply(
        { ...h.ctx(), live: true },
        'lib-helpline-front-door',
        {},
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ errorCode: 'not_blank' }),
    });
  });

  it('refuses an unknown template', async () => {
    const h = harness();
    await expect(h.service.apply(h.ctx(), 'nope', {})).rejects.toMatchObject({
      response: expect.objectContaining({ errorCode: 'unknown_template' }),
    });
  });

  it('keeps languages a setup answer chose, else uses the template’s', () => {
    expect(chosenLanguages(['en'], ['en', 'hi'])).toEqual(['en', 'hi']);
    expect(chosenLanguages(['ta', 'en'], ['en'])).toEqual(['ta', 'en']);
  });
});
