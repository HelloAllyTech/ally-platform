import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  BotPageAccess,
  BotPageAccessKind,
  BotPageStatus,
} from '../../chatbot/enum/bot-page.enum';
import {
  ChatbotAccessMode,
  ChatbotStatus,
} from '../../chatbot/enum/chatbot.enum';
import { DEFAULT_BOT_PAGE_LIMITS } from '../../chatbot/type/bot-page.type';
import {
  BotDraftStatus,
  BotDraftStep,
  DesignId,
  LearnedSection,
  PurposeId,
  SafetyPackId,
} from '../enum/bot-draft.enum';
import { SAFETY_PACKS } from '../safety-pack/safety-packs';
import {
  BotDraftPublishService,
  OWNER_NOTES_TITLE,
  pageLanguage,
  publishableConfig,
} from '../service/bot-draft-publish.service';
import { BotDraftService } from '../service/bot-draft.service';
import { memoryDrafts } from './memory-drafts';

jest.mock('src/common/execution/execution-manager', () => ({
  ExecutionManager: {
    getUserId: () => 7,
    getTenantId: () => 'tenant-1',
    getExecutionId: () => undefined,
  },
}));

function harness(
  over: {
    publicAllowed?: boolean;
    settings?: Record<string, unknown>;
    goLive?: { enforced: () => boolean; assertCanGoLive: jest.Mock };
  } = {},
) {
  const config = {
    ...BotDraftService.defaultDraft('Sunrise Mind'),
    assistantName: 'Sunrise assistant',
    introduction: 'Hi, I’m the Sunrise assistant.',
    instructions: 'You answer questions about Sunrise Mind.',
    languages: ['en', 'hi'],
    suggestedQuestions: ['How much is a session?'],
    declineText: 'Please call us on 98200 12345.',
    ownerNotes: 'Your fees: ₹2,000 a session.',
    safetyPackId: SafetyPackId.MENTAL_HEALTH,
    extraNever: ['Quote prices for group sessions'],
    design: 'guide' as never,
  };
  config.branding = { ...config.branding, title: '', assistantName: '' };
  const store = memoryDrafts({
    step: BotDraftStep.SHARE,
    safetyPack: SafetyPackId.MENTAL_HEALTH,
    safetyPackVersion: 1,
    draftConfig: config,
  });
  const chatbot = {
    id: 'bot-1',
    name: 'Sunrise Mind',
    persona: {},
    settings: over.settings ?? { fallbackText: 'Kept.' },
    status: ChatbotStatus.DRAFT,
  };
  let page: { id: string; slug: string; settings?: unknown } | null = null;
  const fakes = {
    access: { assert: jest.fn(async () => ({ chatbot })) },
    settings: {
      getForChatbot: jest.fn(async () => ({
        botPagePublicAllowed: over.publicAllowed ?? false,
      })),
      updateChatbotSettings: jest.fn(async () => ({})),
    },
    botPages: {
      findForChatbot: jest.fn(async () => page),
      view: jest.fn(async () => ({ slug: 'sunrise-mind' })),
      save: jest.fn(async (_bot: unknown, dto: { slug: string }) => {
        page = { id: 'page-1', slug: dto.slug };
        return { slug: dto.slug, link: `https://ally.example/b/${dto.slug}` };
      }),
    },
    pageAccess: { add: jest.fn(async () => ({ added: 0, skipped: 0 })) },
    knowledge: {
      // One id per document: Owner notes, and (Q3-fast) the learned facts.
      createForChatbot: jest.fn(
        async (_bot: string, dto: { title: string }) => ({
          id: dto.title === 'What we learned' ? 'learned-1' : 'notes-1',
        }),
      ),
      updateForChatbot: jest.fn(async () => ({})),
    },
    chatbots: { update: jest.fn(async () => ({})) },
  };
  const service = new BotDraftPublishService(
    store.service,
    store.events as never,
    fakes.access as never,
    fakes.settings as never,
    fakes.botPages as never,
    fakes.pageAccess as never,
    fakes.knowledge as never,
    fakes.chatbots as never,
    undefined,
    over.goLive as never,
  );
  const publish = (dto: Record<string, unknown>) =>
    service.publish(store.row(), dto as never);
  return { store, fakes, publish, service };
}

describe('BotDraftPublishService', () => {
  it('stages the assistant for its checkup without going live or touching the page', async () => {
    const h = harness();
    await h.service.stage(h.store.row());
    expect(h.fakes.chatbots.update).toHaveBeenCalledWith(
      { id: 'bot-1' },
      expect.objectContaining({
        safetyPack: SafetyPackId.MENTAL_HEALTH,
        rules: { never: ['Quote prices for group sessions'] },
        status: ChatbotStatus.DRAFT,
      }),
    );
    expect(h.fakes.settings.updateChatbotSettings).toHaveBeenCalled();
    expect(h.fakes.knowledge.createForChatbot).toHaveBeenCalled();
    expect(h.fakes.botPages.save).not.toHaveBeenCalled();
    expect(h.fakes.pageAccess.add).not.toHaveBeenCalled();
  });

  it("publishes the purpose, and an older draft's design as its purpose", async () => {
    const h = harness();
    const row = h.store.row();
    row.draftConfig.purpose = PurposeId.CUSTOM;
    row.draftConfig.purposeNote = ' Help parents choose a class ';
    await h.service.stage(row);
    expect(h.fakes.chatbots.update).toHaveBeenLastCalledWith(
      { id: 'bot-1' },
      expect.objectContaining({
        purpose: 'custom',
        purposeNote: 'Help parents choose a class',
      }),
    );

    row.draftConfig.purpose = null;
    row.draftConfig.design = DesignId.GUIDE;
    await h.service.stage(row);
    expect(h.fakes.chatbots.update).toHaveBeenLastCalledWith(
      { id: 'bot-1' },
      expect.objectContaining({ purpose: 'answer', purposeNote: null }),
    );
  });

  it('publishes the chatbot, its settings and its page through the 12b services', async () => {
    const h = harness();
    const result = await h.publish({
      access: 'invite',
      emails: ['Asha@Example.com', 'asha@example.com', 'ravi@example.com'],
    });

    expect(result).toEqual({
      chatbotId: 'bot-1',
      slug: 'sunrise-mind',
      link: 'https://ally.example/b/sunrise-mind',
      access: BotPageAccess.INVITE,
    });
    expect(h.fakes.chatbots.update).toHaveBeenCalledWith(
      { id: 'bot-1' },
      expect.objectContaining({
        name: 'Sunrise Mind',
        persona: expect.objectContaining({
          displayName: 'Sunrise assistant',
          systemPrompt: 'You answer questions about Sunrise Mind.',
          greeting: 'Hi, I’m the Sunrise assistant.',
          defaultLanguage: 'en',
        }),
        safetyPack: SafetyPackId.MENTAL_HEALTH,
        safetyPackVersion: SAFETY_PACKS[SafetyPackId.MENTAL_HEALTH].version,
        rules: { never: ['Quote prices for group sessions'] },
        status: ChatbotStatus.LIVE,
      }),
    );
    // The bot's own changes are kept; the pack's floor and the decline wording are added.
    expect(h.fakes.settings.updateChatbotSettings).toHaveBeenCalledWith(
      { id: 'bot-1', safetyPack: SafetyPackId.MENTAL_HEALTH },
      {
        fallbackText: 'Kept.',
        declineText: 'Please call us on 98200 12345.',
        crisisClassifierEnabled: true,
        // Stage 5: the live chatbot replies only in the draft's languages.
        enabledLanguages: ['en', 'hi'],
      },
    );
    expect(h.fakes.knowledge.createForChatbot).toHaveBeenCalledWith(
      'bot-1',
      expect.objectContaining({
        title: OWNER_NOTES_TITLE,
        text: 'Your fees: ₹2,000 a session.',
      }),
    );
    const [, pageDto] = h.fakes.botPages.save.mock.calls[0] as unknown as [
      unknown,
      Record<string, any>,
    ];
    expect(pageDto).toMatchObject({
      status: BotPageStatus.ON,
      slug: 'sunrise-mind',
      access: BotPageAccess.INVITE,
      settings: {
        suggestedQuestions: ['How much is a session?'],
        limits: DEFAULT_BOT_PAGE_LIMITS,
        language: 'auto',
      },
    });
    // Blank page titles fall back to the draft's names.
    expect(pageDto.settings.branding.title).toBe('Sunrise Mind');
    expect(pageDto.settings.branding.assistantName).toBe('Sunrise assistant');
    expect(pageDto.settings.branding.disclaimer).toBe('');
    expect(h.fakes.pageAccess.add).toHaveBeenCalledWith('page-1', [
      { kind: BotPageAccessKind.EMAIL, value: 'asha@example.com' },
      { kind: BotPageAccessKind.EMAIL, value: 'ravi@example.com' },
    ]);
    const row = h.store.row();
    expect(row.status).toBe(BotDraftStatus.PUBLISHED);
    expect(row.step).toBe(BotDraftStep.PUBLISHED);
    expect(row.source.ownerNotesDocumentId).toBe('notes-1');
    expect(row.events[row.events.length - 1]?.kind).toBe('publish');
  });

  it("keeps a platform admin's abilities when the owner publishes or stages (chunk 3b)", async () => {
    const settings = {
      fallbackText: 'Kept.',
      abilities: { hand_over: 'do_it' },
    };
    const h = harness({ settings });
    await h.publish({ access: 'invite', emails: [] });
    await h.service.stage(h.store.row());
    for (const [, sent] of h.fakes.settings.updateChatbotSettings.mock
      .calls as unknown as [unknown, Record<string, unknown>][]) {
      expect(sent.abilities).toEqual({ hand_over: 'do_it' });
    }
    expect(h.fakes.settings.updateChatbotSettings).toHaveBeenCalledTimes(2);
  });

  it('rewrites the learned facts when the draft changes, as the owner outside a request (Q3-fast)', async () => {
    const h = harness();
    await h.service.onLearnedFactsChanged({
      chatbotId: 'bot-1',
      documentId: 'learned-1',
      ownerUserId: 7,
      tenantId: 'tenant-1',
      facts: [
        {
          id: 'f1',
          section: LearnedSection.HOURS,
          text: 'Open 9 to 5',
          sourceUrl: 'https://s.example/contact',
          sourceTitle: 'Contact | Sunrise',
        },
      ],
    });
    expect(h.fakes.knowledge.updateForChatbot).toHaveBeenCalledWith(
      'bot-1',
      'learned-1',
      { text: 'Hours, Contact\nOpen 9 to 5.' },
    );
    // A failure is logged, never thrown at the save that caused it.
    h.fakes.knowledge.updateForChatbot.mockRejectedValueOnce(new Error('gone'));
    await expect(
      h.service.onLearnedFactsChanged({
        chatbotId: 'bot-1',
        documentId: 'learned-1',
        ownerUserId: 7,
        tenantId: null,
        facts: [
          {
            id: 'f1',
            section: LearnedSection.HOURS,
            text: 'Open 9 to 5',
            sourceUrl: 'x',
          },
        ],
      }),
    ).resolves.toBeUndefined();
  });

  it('publishing again converges the same page and notes, with nothing duplicated', async () => {
    const h = harness();
    await h.publish({ access: 'invite', emails: ['asha@example.com'] });
    h.fakes.botPages.view.mockResolvedValue({ slug: 'sunrise-mind-2' });
    await h.publish({ access: 'invite', emails: ['asha@example.com'] });

    // Each document once (Owner notes, and since Q3-fast the learned facts); then updated.
    expect(
      h.fakes.knowledge.createForChatbot.mock.calls.map(
        (call) => (call as unknown as [string, { title: string }])[1].title,
      ),
    ).toEqual(['Owner notes', 'What we learned']);
    expect(h.fakes.knowledge.updateForChatbot).toHaveBeenCalledWith(
      'bot-1',
      'learned-1',
      expect.objectContaining({ text: expect.stringContaining('\n') }),
    );
    expect(h.fakes.knowledge.updateForChatbot).toHaveBeenCalledWith(
      'bot-1',
      'notes-1',
      { text: 'Your fees: ₹2,000 a session.' },
    );
    // The page keeps its link.
    expect(
      h.fakes.botPages.save.mock.calls.map(
        (call) => (call as unknown as [unknown, { slug: string }])[1].slug,
      ),
    ).toEqual(['sunrise-mind', 'sunrise-mind']);
  });

  it('names the link from the assistant, not the early page that holds the site logo', async () => {
    const h = harness();
    // The crawl stored the site's logo on a page created early, off, while the draft was "Host".
    h.fakes.botPages.findForChatbot.mockResolvedValueOnce({
      id: 'page-1',
      slug: 'host',
      status: BotPageStatus.OFF,
    } as never);
    (h.fakes.botPages as Record<string, jest.Mock>).suggestSlug = jest.fn(
      async () => 'sunrise-mind',
    );
    await h.publish({ access: 'invite', emails: ['asha@example.com'] });
    const [, pageDto] = h.fakes.botPages.save.mock.calls[0] as unknown as [
      unknown,
      { slug: string },
    ];
    expect(pageDto.slug).toBe('sunrise-mind');
  });

  it('refuses public while the platform has it off, before writing anything', async () => {
    const h = harness();
    await expect(h.publish({ access: 'public' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(h.fakes.chatbots.update).not.toHaveBeenCalled();
    expect(h.fakes.botPages.save).not.toHaveBeenCalled();
  });

  it('defaults an organisation page to the publisher’s own organisation', async () => {
    const h = harness();
    await h.publish({ access: 'organisation' });
    expect(h.fakes.pageAccess.add).toHaveBeenCalledWith('page-1', [
      { kind: BotPageAccessKind.ORGANISATION, value: 'tenant-1' },
    ]);
  });

  it('invite only with no emails goes live on the access list alone (listed mode, D4)', async () => {
    const h = harness();
    const result = await h.publish({ access: 'invite' });
    expect(result.access).toBe(BotPageAccess.INVITE);
    expect(h.fakes.chatbots.update).toHaveBeenCalledWith(
      { id: 'bot-1' },
      expect.objectContaining({
        status: ChatbotStatus.LIVE,
        accessMode: ChatbotAccessMode.LISTED,
      }),
    );
    // Nobody is added to the page's own list: the entries come from Who may chat only.
    expect(h.fakes.pageAccess.add).toHaveBeenCalledWith('page-1', []);
  });

  it('an organisation page leaves the chatbot access mode as it was', async () => {
    const h = harness();
    await h.publish({ access: 'organisation' });
    const [, patch] = h.fakes.chatbots.update.mock.calls[0] as unknown as [
      unknown,
      Record<string, unknown>,
    ];
    expect(patch).not.toHaveProperty('accessMode');
  });

  it('won’t publish before the assistant is built', async () => {
    const h = harness();
    h.store.poke({ step: BotDraftStep.DESIGN });
    await expect(h.publish({ access: 'invite' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it.each([
    [['en'], 'en'],
    [['hi'], 'hi'],
    [['en', 'ta'], 'auto'],
  ])('page language for %j is %s', (languages, expected) => {
    expect(pageLanguage(languages)).toBe(expected);
  });

  describe('with the go-live gate (Create and Build never walks the old steps)', () => {
    const gate = (on: boolean, red = false) => ({
      enforced: () => on,
      assertCanGoLive: jest.fn(async () => {
        if (red)
          throw new ConflictException({ errorCode: 'go_live_incomplete' });
        return { ok: true, enforced: on };
      }),
    });

    it('publishes a templated draft still at `learned` when the gate is green', async () => {
      const goLive = gate(true);
      const h = harness({ goLive });
      h.store.poke({ step: BotDraftStep.LEARNED });
      const result = await h.publish({ access: 'invite' });
      expect(goLive.assertCanGoLive).toHaveBeenCalledWith('bot-1', {
        purpose: expect.anything(),
      });
      expect(result).toMatchObject({ chatbotId: 'bot-1', access: 'invite' });
      expect(h.fakes.chatbots.update).toHaveBeenCalledWith(
        { id: 'bot-1' },
        expect.objectContaining({
          status: ChatbotStatus.LIVE,
          accessMode: ChatbotAccessMode.LISTED,
        }),
      );
      expect(h.fakes.botPages.save).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ status: BotPageStatus.ON }),
      );
      expect(h.store.row()).toMatchObject({
        status: BotDraftStatus.PUBLISHED,
        step: BotDraftStep.PUBLISHED,
      });
    });

    it('is refused when the gate is red, before anything is written', async () => {
      const h = harness({ goLive: gate(true, true) });
      h.store.poke({ step: BotDraftStep.LEARNED });
      await expect(h.publish({ access: 'invite' })).rejects.toMatchObject({
        response: { errorCode: 'go_live_incomplete' },
      });
      expect(h.fakes.chatbots.update).not.toHaveBeenCalled();
      expect(h.fakes.botPages.save).not.toHaveBeenCalled();
      expect(h.store.row().status).not.toBe(BotDraftStatus.PUBLISHED);
    });

    it('keeps the old step rule when the gate is switched off', async () => {
      const h = harness({ goLive: gate(false) });
      h.store.poke({ step: BotDraftStep.LEARNED });
      await expect(h.publish({ access: 'invite' })).rejects.toMatchObject({
        response: { errorCode: 'not_ready' },
      });
      expect(h.fakes.chatbots.update).not.toHaveBeenCalled();
    });

    it('still refuses an abandoned draft', async () => {
      const h = harness({ goLive: gate(true) });
      h.store.poke({ status: BotDraftStatus.ABANDONED });
      await expect(h.publish({ access: 'invite' })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('fills fields the new flow never set instead of failing half-way', async () => {
      const h = harness({ goLive: gate(true) });
      h.store.poke({
        step: BotDraftStep.LEARNED,
        draftConfig: {
          name: 'Sunrise',
          safetyPackId: SafetyPackId.MENTAL_HEALTH,
        } as never,
      });
      await expect(h.publish({ access: 'invite' })).resolves.toMatchObject({
        chatbotId: 'bot-1',
      });
      expect(h.fakes.botPages.save).toHaveBeenCalled();
      expect(h.store.row().status).toBe(BotDraftStatus.PUBLISHED);
    });
  });

  it('publishableConfig keeps set values and fills missing ones', () => {
    const c = publishableConfig(
      { name: 'X', languages: ['hi'], safetyPackId: null } as never,
      'Bot',
    );
    expect(c).toMatchObject({
      name: 'X',
      languages: ['hi'],
      safetyPackId: null,
      declineText: '',
      extraNever: [],
    });
    expect(c.branding.title).toBe('X');
    expect(publishableConfig(undefined, 'Bot').name).toBe('Bot');
  });
});
