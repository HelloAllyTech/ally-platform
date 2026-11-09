import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Chatbot } from '../../chatbot/entity/chatbot.entity';
import { ChatbotPage } from '../../chatbot/entity/chatbot-page.entity';
import {
  BotPageAccess,
  BotPageStatus,
  PrechatFieldType,
} from '../../chatbot/enum/bot-page.enum';
import { ChatbotMemberRole } from '../../chatbot/enum/chatbot.enum';
import {
  BotPageSettings,
  defaultBotPageSettings,
  mergeBotPageSettings,
} from '../../chatbot/type/bot-page.type';
import { SafetyPackId } from '../enum/bot-draft.enum';
import { findSource, replaceSource } from '../home/correction';
import {
  AssistantHomeService,
  STALE_MESSAGE,
} from '../home/assistant-home.service';
import { HOME_FIELDS, HomeState, versionOf } from '../home/home-fields';
import { changeOwnRules, safetyView } from '../home/own-rules';
import { SafetyLockedError } from '../safety-pack/safety-lock';
import { SAFETY_PACKS } from '../safety-pack/safety-packs';
import { memoryDrafts } from './memory-drafts';

jest.mock('src/common/execution/execution-manager', () => ({
  ExecutionManager: {
    getUserId: () => 7,
    getTenantId: () => 'tenant-1',
    getExecutionId: () => undefined,
  },
}));

const PACK = SAFETY_PACKS[SafetyPackId.MENTAL_HEALTH];

function stateWith(over: Partial<HomeState['chatbot']> = {}): HomeState {
  const chatbot = {
    name: 'Sunrise Mind',
    description: null,
    persona: { displayName: 'Sunrise assistant', greeting: 'Hi.' },
    settings: {},
    safetyPack: null,
    ...over,
  } as HomeState['chatbot'];
  return {
    chatbot,
    page: defaultBotPageSettings({ ...chatbot, crisisSafetyOn: false }),
    pageRow: { status: BotPageStatus.ON, access: BotPageAccess.INVITE },
    publicAllowed: false,
  };
}

describe('Assistant home fields', () => {
  it('writes the assistant name to the persona and the page together', () => {
    const write = HOME_FIELDS.assistantName.write('Asha', stateWith());
    expect(write.chatbot?.persona).toEqual({
      displayName: 'Asha',
      greeting: 'Hi.',
    });
    expect(write.page?.branding?.assistantName).toBe('Asha');
  });

  it('writes the disclaimer to the settings and the page together', () => {
    const write = HOME_FIELDS.disclaimer.write(
      'Not medical advice.',
      stateWith(),
    );
    expect(write.chatbot?.settings?.disclaimerText).toBe('Not medical advice.');
    expect(write.page?.branding?.disclaimer).toBe('Not medical advice.');
  });

  it("refuses a disclaimer that drops the safety pack's", () => {
    const state = stateWith({ safetyPack: SafetyPackId.MENTAL_HEALTH });
    expect(() => HOME_FIELDS.disclaimer.write('Hello.', state)).toThrow(
      SafetyLockedError,
    );
    expect(() =>
      HOME_FIELDS.disclaimer.write(
        `${PACK.disclaimer} Call us any time.`,
        state,
      ),
    ).not.toThrow();
  });

  it('drops a wording override when it is emptied, so the default applies', () => {
    const state = stateWith({ settings: { declineText: 'Call us.' } });
    expect(HOME_FIELDS.declineText.write('', state).chatbot?.settings).toEqual(
      {},
    );
  });

  it('checks lists against the page bounds', () => {
    expect(() =>
      HOME_FIELDS.suggestedQuestions.parse(['a?', 'b?', 'c?', 'd?', 'e?']),
    ).toThrow('Up to 4 suggested questions.');
    expect(() =>
      HOME_FIELDS.prechat.parse([
        {
          id: 'a',
          label: 'Pick',
          type: PrechatFieldType.CHOICE,
          required: true,
        },
      ]),
    ).toThrow('A choice question needs its options.');
    expect(
      HOME_FIELDS.prechat.parse([
        {
          id: 'ok',
          label: ' Agree? ',
          type: PrechatFieldType.CONSENT,
          required: false,
          consentText: 'I agree.',
        },
      ]),
    ).toEqual([
      {
        id: 'ok',
        label: 'Agree?',
        type: PrechatFieldType.CONSENT,
        required: true,
        consentText: 'I agree.',
      },
    ]);
  });

  it('turns the page on or off, and refuses public while the platform does', () => {
    expect(
      HOME_FIELDS.pageStatus.write(BotPageStatus.OFF, stateWith()),
    ).toEqual({
      pageRow: { status: BotPageStatus.OFF },
    });
    expect(() =>
      HOME_FIELDS.pageAccess.write(BotPageAccess.PUBLIC, stateWith()),
    ).toThrow('Public links are turned off for now.');
    expect(
      HOME_FIELDS.pageAccess.write(BotPageAccess.PUBLIC, {
        ...stateWith(),
        publicAllowed: true,
      }),
    ).toEqual({ pageRow: { access: BotPageAccess.PUBLIC } });
  });

  it('versions values without regard to key order', () => {
    expect(versionOf({ a: 1, b: [1, { c: 2, d: 3 }] })).toBe(
      versionOf({ b: [1, { d: 3, c: 2 }], a: 1 }),
    );
    expect(versionOf('a')).not.toBe(versionOf('b'));
    expect(versionOf('a')).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('Own safety rules', () => {
  it('lists the pack rules as fixed, then the owner’s own', () => {
    const view = safetyView(SafetyPackId.MENTAL_HEALTH, ['Quote group prices']);
    expect(view.pack?.name).toBe(PACK.name);
    expect(view.rules.filter((r) => r.fixed)).toHaveLength(PACK.never.length);
    expect(view.rules[view.rules.length - 1]).toEqual({
      id: 'own-0',
      text: 'Quote group prices',
      fixed: false,
    });
  });

  it('adds a rule of the owner’s own', () => {
    expect(
      changeOwnRules(['One rule'], { op: 'add', text: ' Two rule ' }),
    ).toEqual(['One rule', 'Two rule']);
  });

  it('never removes or edits a pack rule', () => {
    expect(() => changeOwnRules([], { op: 'remove', id: 'pack-0' })).toThrow(
      SafetyLockedError,
    );
    expect(() =>
      changeOwnRules([], { op: 'edit', id: 'pack-0', text: 'Anything goes' }),
    ).toThrow(SafetyLockedError);
  });

  it('edits and removes the owner’s own rules, and refuses duplicates', () => {
    expect(
      changeOwnRules(['a rule', 'b rule'], { op: 'remove', id: 'own-0' }),
    ).toEqual(['b rule']);
    expect(
      changeOwnRules(['a rule'], { op: 'edit', id: 'own-0', text: 'c rule' }),
    ).toEqual(['c rule']);
    expect(() =>
      changeOwnRules(['a rule'], { op: 'add', text: 'A RULE' }),
    ).toThrow('You already have this rule.');
    expect(() => changeOwnRules([], { op: 'remove', id: 'own-3' })).toThrow(
      'That rule is no longer there.',
    );
  });
});

describe('Correction matching', () => {
  const page =
    'Welcome to Sunrise Mind. Individual sessions cost ₹2,000 and last 50 minutes. We are open Monday to Saturday.';

  it('finds the sentence a summarised fact came from', () => {
    expect(findSource(page, 'Sessions cost ₹2,000.')?.text).toBe(
      'Individual sessions cost ₹2,000 and last 50 minutes.',
    );
  });

  it('replaces only that sentence', () => {
    expect(
      replaceSource(page, 'Sessions cost ₹2,000.', 'Sessions cost ₹2,500'),
    ).toBe(
      'Welcome to Sunrise Mind. Sessions cost ₹2,500. We are open Monday to Saturday.',
    );
  });

  it('replaces nothing when no sentence shares enough of the fact', () => {
    expect(
      replaceSource(page, 'Parking is free for patients.', 'No parking.'),
    ).toBeNull();
  });
});

/** The service over one bot and its page in memory, with saves serialised as the row lock does. */
function harness(over: { safetyPack?: string | null } = {}) {
  const chatbot = {
    id: 'bot-1',
    name: 'Sunrise Mind',
    description: null,
    persona: { displayName: 'Sunrise assistant', greeting: 'Hi.' },
    settings: {},
    safetyPack: over.safetyPack ?? null,
    rules: { never: [] as string[] },
  } as unknown as Chatbot;
  let page: ChatbotPage | null = {
    id: 'page-1',
    chatbotId: 'bot-1',
    settings: { suggestedQuestions: ['How much is a session?'] },
  } as unknown as ChatbotPage;

  const repositories = new Map<unknown, unknown>([
    [
      Chatbot,
      {
        findOne: async () => ({ ...chatbot }),
        update: async (_where: unknown, patch: Partial<Chatbot>) => {
          Object.assign(chatbot, patch);
        },
      },
    ],
    [
      ChatbotPage,
      {
        findOne: async () => page,
        update: async (_where: unknown, patch: Partial<ChatbotPage>) => {
          page = { ...page!, ...patch };
        },
        insert: async (row: ChatbotPage) => {
          page = { ...row, id: 'page-2' } as ChatbotPage;
        },
      },
    ],
  ]);
  let queue = Promise.resolve();
  const dataSource = {
    transaction: <T>(run: (manager: unknown) => Promise<T>) => {
      const result = queue.then(() =>
        run({ getRepository: (entity: unknown) => repositories.get(entity) }),
      );
      queue = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };
  const pages = {
    view: async (bot: Chatbot) => ({
      saved: Boolean(page),
      slug: 'sunrise-mind',
      status: page?.status ?? BotPageStatus.OFF,
      access: page?.access ?? BotPageAccess.INVITE,
      publicAllowed: false,
      settings: mergeBotPageSettings(
        defaultBotPageSettings({ ...bot, crisisSafetyOn: false }),
        page?.settings as Partial<BotPageSettings> | undefined,
      ),
    }),
  };
  const drafts = memoryDrafts();
  const knowledge = {
    getForChatbot: jest.fn(async () => ({
      rawText:
        'Welcome to Sunrise Mind. Individual sessions cost ₹2,000 and last 50 minutes.',
    })),
    updateForChatbot: jest.fn(async () => ({})),
  };
  const publisher = { ownerNotes: jest.fn(async () => 'notes-1') };
  const access = {
    assert: jest.fn(async () => ({
      chatbot: { ...chatbot },
      role: ChatbotMemberRole.OWNER,
    })),
  };
  const service = new AssistantHomeService(
    dataSource as never,
    access as never,
    pages as never,
    drafts.service,
    publisher as never,
    knowledge as never,
  );
  return {
    service,
    chatbot,
    page: () => page,
    drafts,
    knowledge,
    publisher,
    access,
  };
}

describe('AssistantHomeService', () => {
  it('loads every field with its version, the safety rules and the facts', async () => {
    const { service } = harness({ safetyPack: SafetyPackId.MENTAL_HEALTH });
    const home = await service.get('bot-1');
    expect(home.fields.assistantName).toEqual({
      value: 'Sunrise assistant',
      version: versionOf('Sunrise assistant'),
    });
    expect(home.fields.suggestedQuestions.value).toEqual([
      'How much is a session?',
    ]);
    expect(home.safety.pack?.id).toBe(SafetyPackId.MENTAL_HEALTH);
    expect(home.facts[0]).toMatchObject({
      id: 'f1',
      version: versionOf('Sessions cost ₹2,000.'),
    });
    expect(home.canEdit).toBe(true);
  });

  it('saves a field to both its places', async () => {
    const { service, chatbot, page } = harness();
    const saved = await service.saveField('bot-1', {
      field: 'assistantName',
      value: ' Asha ',
      version: versionOf('Sunrise assistant'),
    });
    expect(saved).toEqual({
      field: 'assistantName',
      value: 'Asha',
      version: versionOf('Asha'),
    });
    expect(chatbot.persona.displayName).toBe('Asha');
    expect(page()!.settings.branding.assistantName).toBe('Asha');
    // The page's other stored keys are kept.
    expect(page()!.settings.suggestedQuestions).toEqual([
      'How much is a session?',
    ]);
  });

  it('two tabs editing the same field: the second save is refused with the first one’s value', async () => {
    const { service, chatbot } = harness();
    // Both tabs opened the home on the same value.
    const opened = (await service.get('bot-1')).fields.introduction.version;

    await service.saveField('bot-1', {
      field: 'introduction',
      value: 'From tab one.',
      version: opened,
    });
    const refused = await service
      .saveField('bot-1', {
        field: 'introduction',
        value: 'From tab two.',
        version: opened,
      })
      .catch((error) => error);

    expect(refused).toBeInstanceOf(ConflictException);
    expect(refused.getResponse()).toEqual({
      errorCode: 'stale',
      message: STALE_MESSAGE,
      details: {
        field: 'introduction',
        value: 'From tab one.',
        version: versionOf('From tab one.'),
      },
    });
    expect(chatbot.persona.greeting).toBe('From tab one.');

    // Tab two, now showing tab one's value, saves on top of it.
    await service.saveField('bot-1', {
      field: 'introduction',
      value: 'From tab two.',
      version: refused.getResponse().details.version,
    });
    expect(chatbot.persona.greeting).toBe('From tab two.');
  });

  it('two tabs saving at the same moment: exactly one wins', async () => {
    const { service, chatbot } = harness();
    const opened = versionOf('Hi.');
    const results = await Promise.allSettled(
      ['One.', 'Two.'].map((value) =>
        service.saveField('bot-1', {
          field: 'introduction',
          value,
          version: opened,
        }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([
      'fulfilled',
      'rejected',
    ]);
    const won = results.find(
      (r) => r.status === 'fulfilled',
    ) as PromiseFulfilledResult<{ value: string }>;
    expect(chatbot.persona.greeting).toBe(won.value.value);
  });

  it('saves who can open the page to the page itself', async () => {
    const { service, page } = harness();
    await service.saveField('bot-1', {
      field: 'pageAccess',
      value: BotPageAccess.ORGANISATION,
      version: versionOf(BotPageAccess.INVITE),
    });
    expect(page()!.access).toBe(BotPageAccess.ORGANISATION);
  });

  it('different fields never conflict', async () => {
    const { service } = harness();
    const home = await service.get('bot-1');
    await service.saveField('bot-1', {
      field: 'introduction',
      value: 'Hello.',
      version: home.fields.introduction.version,
    });
    await expect(
      service.saveField('bot-1', {
        field: 'tone',
        value: 'warm',
        version: home.fields.tone.version,
      }),
    ).resolves.toMatchObject({ value: 'warm' });
  });

  it('refuses an unknown field, a bad value and a weakened pack as 400s', async () => {
    const { service } = harness({ safetyPack: SafetyPackId.MENTAL_HEALTH });
    await expect(
      service.saveField('bot-1', {
        field: 'model',
        value: 'x',
        version: versionOf(''),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.saveField('bot-1', {
        field: 'assistantName',
        value: '',
        version: versionOf('Sunrise assistant'),
      }),
    ).rejects.toMatchObject({
      response: {
        errorCode: 'invalid_value',
        details: { field: 'assistantName' },
      },
    });
    const home = await service.get('bot-1');
    await expect(
      service.saveField('bot-1', {
        field: 'disclaimer',
        value: 'Just a chat.',
        version: home.fields.disclaimer.version,
      }),
    ).rejects.toMatchObject({
      response: {
        errorCode: 'safety_locked',
        details: { field: 'disclaimer' },
      },
    });
  });

  it('needs an editor to save', async () => {
    const { service, access } = harness();
    await service
      .saveField('bot-1', {
        field: 'tone',
        value: 'warm',
        version: versionOf(''),
      })
      .catch(() => undefined);
    expect(access.assert).toHaveBeenCalledWith(
      'bot-1',
      ChatbotMemberRole.EDITOR,
    );
  });

  it('adds an own rule, but a pack rule can’t be removed or edited', async () => {
    const { service, chatbot } = harness({
      safetyPack: SafetyPackId.MENTAL_HEALTH,
    });
    const view = await service.changeRule('bot-1', {
      op: 'add',
      text: 'Quote prices for group sessions',
      version: versionOf([]),
    });
    expect(chatbot.rules.never).toEqual(['Quote prices for group sessions']);
    expect(view.rules[view.rules.length - 1]).toMatchObject({
      id: 'own-0',
      fixed: false,
    });

    for (const change of [
      { op: 'remove' as const, id: 'pack-0' },
      { op: 'edit' as const, id: 'pack-0', text: 'Diagnose people' },
    ]) {
      await expect(
        service.changeRule('bot-1', { ...change, version: view.version }),
      ).rejects.toMatchObject({ response: { errorCode: 'safety_locked' } });
    }
    expect(chatbot.rules.never).toEqual(['Quote prices for group sessions']);
  });

  it('refuses a rule change based on an older list', async () => {
    const { service } = harness();
    await service.changeRule('bot-1', {
      op: 'add',
      text: 'Rule one',
      version: versionOf([]),
    });
    await expect(
      service.changeRule('bot-1', {
        op: 'add',
        text: 'Rule two',
        version: versionOf([]),
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  describe('correcting a fact', () => {
    function withPage() {
      const h = harness();
      h.drafts.poke({
        crawl: {
          ...h.drafts.row().crawl!,
          pages: [{ ...h.drafts.row().crawl!.pages[0], documentId: 'doc-1' }],
        },
      });
      return h;
    }

    it('replaces the original in its page and keeps it for "Show original"', async () => {
      const h = withPage();
      const result = await h.service.correctFact('bot-1', 'f1', {
        text: 'Sessions cost ₹2,500.',
        version: versionOf('Sessions cost ₹2,000.'),
      });
      expect(result.appliedTo).toBe('page');
      expect(h.knowledge.updateForChatbot).toHaveBeenCalledWith(
        'bot-1',
        'doc-1',
        {
          text: 'Welcome to Sunrise Mind. Sessions cost ₹2,500.',
        },
      );
      const fact = h.drafts.row().learned.facts[0];
      expect(fact).toMatchObject({
        text: 'Sessions cost ₹2,500.',
        byOwner: true,
        correction: {
          originalText: 'Sessions cost ₹2,000.',
          appliedTo: 'page',
          documentId: 'doc-1',
          notesDocumentId: 'notes-1',
        },
      });
      expect(fact.correction?.pageHash).toMatch(/^[0-9a-f]{64}$/);
      // Also an owner note, linked from the fact.
      expect(h.publisher.ownerNotes).toHaveBeenCalledWith(expect.anything(), {
        ownerNotes: 'Sessions cost ₹2,500.',
      });
      expect(h.drafts.row().source.ownerNotesDocumentId).toBe('notes-1');
    });

    it('goes into the notes only when the page has no matching sentence', async () => {
      const h = withPage();
      h.knowledge.getForChatbot.mockResolvedValueOnce({
        rawText: 'Nothing related.',
      });
      const result = await h.service.correctFact('bot-1', 'f1', {
        text: 'Sessions cost ₹2,500.',
        version: versionOf('Sessions cost ₹2,000.'),
      });
      expect(result.appliedTo).toBe('notes');
      expect(h.knowledge.updateForChatbot).not.toHaveBeenCalled();
      expect(h.drafts.row().learned.facts[0].correction).toMatchObject({
        appliedTo: 'notes',
        documentId: null,
      });
    });

    it('a second correction keeps the first original', async () => {
      const h = withPage();
      await h.service.correctFact('bot-1', 'f1', {
        text: 'Sessions cost ₹2,500.',
        version: versionOf('Sessions cost ₹2,000.'),
      });
      h.knowledge.getForChatbot.mockResolvedValueOnce({
        rawText: 'Welcome to Sunrise Mind. Sessions cost ₹2,500.',
      });
      await h.service.correctFact('bot-1', 'f1', {
        text: 'Sessions cost ₹3,000.',
        version: versionOf('Sessions cost ₹2,500.'),
      });
      expect(h.drafts.row().learned.facts[0].correction).toMatchObject({
        text: 'Sessions cost ₹3,000.',
        originalText: 'Sessions cost ₹2,000.',
      });
    });

    it('adds to the notes as the owner last edited them', async () => {
      const h = withPage();
      h.drafts.poke({
        source: { ...h.drafts.row().source, ownerNotesDocumentId: 'notes-1' },
      });
      h.knowledge.getForChatbot
        .mockResolvedValueOnce({
          rawText:
            'Welcome to Sunrise Mind. Individual sessions cost ₹2,000 and last 50 minutes.',
        })
        .mockResolvedValueOnce({ rawText: 'Edited in the home.' } as never);
      await h.service.correctFact('bot-1', 'f1', {
        text: 'Sessions cost ₹2,500.',
        version: versionOf('Sessions cost ₹2,000.'),
      });
      expect(h.publisher.ownerNotes).toHaveBeenCalledWith(expect.anything(), {
        ownerNotes: 'Edited in the home.\nSessions cost ₹2,500.',
      });
    });

    it('refuses a stale correction and an unknown fact', async () => {
      const h = withPage();
      await expect(
        h.service.correctFact('bot-1', 'f1', {
          text: 'x',
          version: versionOf('old'),
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      await expect(
        h.service.correctFact('bot-1', 'nope', {
          text: 'x',
          version: versionOf(''),
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});

describe('Assistant home copy', () => {
  const { readFileSync } = require('fs');

  const { join } = require('path');
  const deck: string = readFileSync(
    join(__dirname, '../../../../docs/agents-v2/ONBOARDING-COPY.md'),
    'utf8',
  );
  const message = (run: () => unknown) => {
    try {
      run();
    } catch (error) {
      return (error as Error).message;
    }
    throw new Error('expected a refusal');
  };

  it('says what the deck says when a save is stale', () => {
    expect(deck).toContain(STALE_MESSAGE);
  });

  it.each(Object.keys(HOME_FIELDS))('names %s as the deck does', (name) => {
    const field = HOME_FIELDS[name as keyof typeof HOME_FIELDS] as {
      parse: (value: unknown) => unknown;
    };
    const text = message(() => field.parse('x'.repeat(5000)));
    const label = text.split(' can be at most ')[0];
    if (label !== text) expect(deck).toContain(label);
  });

  it.each([
    () => changeOwnRules([], { op: 'add', text: 'x' }),
    () => changeOwnRules([], { op: 'add', text: 'x'.repeat(300) }),
    () => changeOwnRules(['a rule'], { op: 'add', text: 'a rule' }),
    () => changeOwnRules([], { op: 'remove', id: 'own-0' }),
    () => HOME_FIELDS.suggestedQuestions.parse(['a', 'b', 'c', 'd', 'e']),
    () => HOME_FIELDS.language.parse('fr'),
    () => HOME_FIELDS.pageStatus.parse('maybe'),
    () => HOME_FIELDS.pageAccess.parse('everyone'),
    () => HOME_FIELDS.pageAccess.write(BotPageAccess.PUBLIC, stateWith()),
  ])('refuses in the deck’s words (%#)', (run) => {
    expect(deck).toContain(message(run));
  });
});
