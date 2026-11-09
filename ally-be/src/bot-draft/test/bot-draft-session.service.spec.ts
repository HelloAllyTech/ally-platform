import { ConflictException } from '@nestjs/common';
import type {
  BuilderStepResponse,
  BuilderStreamEvent,
} from '../../ai/dto/builder.dto';
import { ONBOARDING_COPY } from '../copy/onboarding-copy';
import {
  BotDraftStatus,
  BotDraftStep,
  SafetyPackId,
} from '../enum/bot-draft.enum';
import { SAFETY_PACKS } from '../safety-pack/safety-packs';
import {
  BotDraftSessionService,
  SessionEvent,
  documentParts,
  findingLines,
} from '../service/bot-draft-session.service';
import { BotDraftService } from '../service/bot-draft.service';
import { memoryDrafts } from './memory-drafts';

jest.mock('src/common/execution/execution-manager', () => ({
  ExecutionManager: {
    getUserId: () => 7,
    getTenantId: () => 'tenant-1',
    getExecutionId: () => undefined,
  },
}));

const reply = (over: Partial<BuilderStepResponse>): BuilderStepResponse => ({
  message: 'One thing I couldn’t find: your fees.',
  chips: ['Add it now', 'Skip for now', 'We don’t offer this'],
  patches: [],
  learned_patches: [],
  next_step: 'learned',
  questions_left: 0,
  asking: '',
  answer: '',
  industry: null,
  gaps: null,
  designs: null,
  dropped_patches: 0,
  ...over,
});

function harness(overrides = {}, response?: BuilderStepResponse) {
  const store = memoryDrafts(overrides);
  const ai = {
    runBuilderStepStreaming: jest.fn(
      async (
        _request: unknown,
        onEvent: (e: BuilderStreamEvent) => void,
      ): Promise<BuilderStepResponse> => {
        onEvent({
          event: 'status',
          data: { code: 'classifying', label: 'x' },
        });
        onEvent({ event: 'token', data: { text: 'One thing ' } });
        return response ?? reply({});
      },
    ),
    extractOnboardingFacts: jest.fn(),
    getPromptOverrides: jest.fn(async () => ({})),
  };
  const documents = { readForOnboarding: jest.fn() };
  const session = new BotDraftSessionService(
    store.service,
    store.events as never,
    ai as never,
    documents as never,
  );
  const emitted: SessionEvent[] = [];
  const turn = (input: { text?: string; chip?: string }) =>
    session.turn(store.row(), input, (e) => emitted.push(e));
  return { store, ai, session, emitted, turn, documents };
}

describe('BotDraftSessionService.turn', () => {
  it('turns the pack on from the industry, says so in its own words, then asks the first question', async () => {
    const h = harness(
      {},
      reply({
        industry: 'mental_health',
        next_step: 'gaps',
        asking: 'fees',
        questions_left: 4,
        gaps: [{ key: 'fees', item: 'your fees', why: 'x' }],
      }),
    );
    const result = await h.turn({ chip: 'Looks right' });
    const row = h.store.row();

    expect(row.draftConfig.safetyPackId).toBe(SafetyPackId.MENTAL_HEALTH);
    expect(row.draftConfig.branding.disclaimer).toBe(
      SAFETY_PACKS[SafetyPackId.MENTAL_HEALTH].disclaimer,
    );
    // learned → safety → gaps, one step at a time.
    expect(row.step).toBe(BotDraftStep.GAPS);
    expect(row.answers).toMatchObject({
      pending: 'fees',
      gaps: [{ key: 'fees' }],
    });

    // Status live; the pack's own words before the reply's tokens.
    expect(h.emitted.map((e) => e.event)).toEqual([
      'status',
      'message',
      'token',
    ]);
    expect((h.emitted[1].data as { text: string }).text).toBe(
      SAFETY_PACKS[SafetyPackId.MENTAL_HEALTH].builderMessage,
    );
    expect(row.transcript.map((t) => t.role)).toEqual([
      'owner',
      'builder',
      'builder',
    ]);
    expect(result.message.chips).toHaveLength(3);
    expect(result.questionsLeft).toBe(4);
  });

  it('applies what it may, drops what it may not, and goes on', async () => {
    const h = harness(
      { step: BotDraftStep.GAPS, answers: { pending: 'languages' } },
      reply({
        next_step: 'gaps',
        answer: 'English, Hindi',
        asking: 'decline',
        patches: [
          { op: 'replace', path: '/languages', value: ['en', 'hi'] },
          { op: 'replace', path: '/safetyPackId', value: 'standard' },
          { op: 'replace', path: '/tone', value: 'shouty' },
        ],
      }),
    );
    await h.turn({ chip: 'English, Hindi' });
    const row = h.store.row();
    expect(row.draftConfig.languages).toEqual(['en', 'hi']);
    expect(row.draftConfig.safetyPackId).toBe(SafetyPackId.STANDARD);
    expect(row.draftConfig.tone).toBe('warm');
    expect(row.answers).toMatchObject({
      values: { languages: 'English, Hindi' },
      pending: 'decline',
    });
  });

  it('stores the purpose, and Train my team defaults to the organisation only', async () => {
    const h = harness(
      { step: BotDraftStep.DESIGN },
      reply({
        next_step: 'design',
        patches: [{ op: 'replace', path: '/purpose', value: 'training' }],
      }),
    );
    await h.turn({ chip: 'purpose:training' });
    const row = h.store.row();
    expect(row.draftConfig.purpose).toBe('training');
    expect(row.draftConfig.access.mode).toBe('organisation');
  });

  it('never overrides who can use it once the owner chose', async () => {
    const h = harness(
      {
        step: BotDraftStep.DESIGN,
        draftConfig: {
          ...BotDraftService.defaultDraft('Sunrise Mind'),
          access: { mode: 'invite', emails: ['a@b.co'], organisationIds: [] },
        },
      },
      reply({
        next_step: 'design',
        patches: [{ op: 'replace', path: '/purpose', value: 'training' }],
      }),
    );
    await h.turn({ chip: 'purpose:training' });
    expect(h.store.row().draftConfig.access.mode).toBe('invite');
  });

  it('leaves who can use it alone for other purposes', async () => {
    const h = harness(
      { step: BotDraftStep.DESIGN },
      reply({
        next_step: 'design',
        patches: [{ op: 'replace', path: '/purpose', value: 'enquiries' }],
      }),
    );
    await h.turn({ chip: 'purpose:enquiries' });
    expect(h.store.row().draftConfig.access.mode).toBe('invite');
  });

  it('gives a mental health non-profit Mental health safety, from its cause', async () => {
    const h = harness(
      {},
      reply({
        industry: 'non_profit',
        care_topics: ['mental_health'],
        next_step: 'gaps',
      }),
    );
    await h.turn({ chip: 'Looks right' });
    const row = h.store.row();
    expect(row.industry).toBe('non_profit');
    expect(row.draftConfig.safetyPackId).toBe(SafetyPackId.MENTAL_HEALTH);
  });

  it('never lets the builder weaken a pack that is on', async () => {
    const h = harness(
      {},
      reply({
        industry: 'd2c',
        next_step: 'gaps',
      }),
    );
    h.store.poke({
      safetyPack: SafetyPackId.MEDICAL,
      draftConfig: {
        ...h.store.row().draftConfig,
        safetyPackId: SafetyPackId.MEDICAL,
      },
    });
    await h.turn({ chip: 'Looks right' });
    expect(h.store.row().draftConfig.safetyPackId).toBe(SafetyPackId.MEDICAL);
  });

  it('builds on the draft as it is now, not as it was when the step began', async () => {
    const h = harness(
      { step: BotDraftStep.DESIGN },
      reply({
        next_step: 'share',
        message: ONBOARDING_COPY.looksRight,
        patches: [
          { op: 'replace', path: '/design', value: 'guide' },
          { op: 'replace', path: '/introduction', value: 'Hi, I’m Sunrise.' },
        ],
      }),
    );
    h.ai.runBuilderStepStreaming.mockImplementationOnce(async () => {
      // The owner renamed the page while the builder was writing.
      const row = h.store.row();
      h.store.poke({
        version: row.version + 1,
        draftConfig: {
          ...row.draftConfig,
          branding: { ...row.draftConfig.branding, title: 'Sunrise Clinic' },
        },
      });
      return reply({
        next_step: 'share',
        patches: [{ op: 'replace', path: '/design', value: 'guide' }],
      });
    });
    await h.turn({ chip: 'design:guide' });
    const row = h.store.row();
    expect(row.draftConfig.branding.title).toBe('Sunrise Clinic');
    expect(row.draftConfig.design).toBe('guide');
    expect(row.step).toBe(BotDraftStep.SHARE);
  });

  it('a stopped turn leaves the draft exactly as it was', async () => {
    const h = harness();
    const before = h.store.row();
    const stop = new AbortController();
    h.ai.runBuilderStepStreaming.mockImplementationOnce(async () => {
      stop.abort();
      throw new DOMException('The operation was aborted', 'AbortError');
    });
    await expect(
      h.session.turn(before, { text: 'hello' }, () => undefined, stop.signal),
    ).rejects.toThrow();
    const after = h.store.row();
    expect(after.transcript).toEqual(before.transcript);
    expect(after.version).toBe(before.version);
  });

  it('refuses a finished setup', async () => {
    const h = harness({ status: BotDraftStatus.PUBLISHED });
    await expect(h.turn({ text: 'hi' })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(h.ai.runBuilderStepStreaming).not.toHaveBeenCalled();
  });
});

describe('BotDraftSessionService as the crawl’s learner', () => {
  it('keeps only facts sourced to a page in the batch, and counts the rest', async () => {
    const h = harness({ learned: { facts: [], dropped: 1 } });
    h.ai.extractOnboardingFacts.mockResolvedValue({
      facts: [
        {
          section: 'hours',
          text: 'Open 9 to 5.',
          source_url: 'https://sunrise.example/contact',
          source_title: 'Contact',
        },
        {
          section: 'about',
          text: 'Founded in 1990.',
          source_url: 'https://elsewhere.example/',
          source_title: '',
        },
      ],
      dropped: 2,
      findings: ['Found your opening hours'],
    });
    await h.session.learnFrom('draft-1', [
      {
        url: 'https://sunrise.example/contact',
        title: 'Contact',
        status: 'read',
        text: 'Open 9 to 5. Call 98200 12345.',
      },
    ]);
    const row = h.store.row();
    expect(row.learned.facts).toEqual([
      expect.objectContaining({
        section: 'hours',
        text: 'Open 9 to 5.',
        sourceUrl: 'https://sunrise.example/contact',
        sourceTitle: 'Contact',
      }),
    ]);
    expect(row.learned.dropped).toBe(1 + 2 + 1);
    // Running totals over everything learned, not the batch's own count.
    expect(h.store.events.publish).toHaveBeenCalledWith('draft-1', {
      type: 'finding',
      text: 'Found your opening hours',
    });
    expect(
      findingLines([
        ...row.learned.facts,
        { ...row.learned.facts[0], id: 't1', section: 'team' as never },
        { ...row.learned.facts[0], id: 't2', section: 'team' as never },
      ]),
    ).toEqual(['Found your opening hours', 'Found 2 team members']);
  });

  it('names the draft from the site, once, and never over the owner’s name', async () => {
    const h = harness({
      learned: { facts: [], dropped: 0 },
      source: { website: 'https://sunrise.example/', autoName: 'Sunrise Mind' },
    });
    h.ai.extractOnboardingFacts.mockResolvedValue({
      facts: [],
      dropped: 0,
      findings: [],
      business_name: 'Sunrise Mind Clinic',
    });
    const page = {
      url: 'https://sunrise.example/',
      title: 'Home',
      status: 'read' as const,
      text: 'x',
    };
    await h.session.learnFrom('draft-1', [page]);
    let row = h.store.row();
    expect(row.draftConfig.name).toBe('Sunrise Mind Clinic');
    expect(row.draftConfig.branding.title).toBe('Sunrise Mind Clinic');
    expect(row.source.autoName).toBeNull();

    h.ai.extractOnboardingFacts.mockResolvedValue({
      facts: [],
      dropped: 0,
      findings: [],
      business_name: 'Something Else',
    });
    await h.session.learnFrom('draft-1', [page]);
    row = h.store.row();
    expect(row.draftConfig.name).toBe('Sunrise Mind Clinic');
  });

  it('marks a description’s details as the owner’s', async () => {
    const h = harness({ learned: { facts: [], dropped: 0 } });
    h.ai.extractOnboardingFacts.mockResolvedValue({
      facts: [
        {
          section: 'about',
          text: 'We teach maths to Class 10.',
          source_url: 'owner',
          source_title: 'From you',
        },
      ],
      dropped: 0,
      findings: [],
    });
    await h.session.learnFromDescription(
      'draft-1',
      'We teach maths to Class 10.',
    );
    const row = h.store.row();
    expect(row.learned.facts[0]).toMatchObject({
      sourceUrl: 'owner',
      byOwner: true,
    });
    expect(row.transcript.slice(-1)[0]).toMatchObject({
      role: 'builder',
      text: ONBOARDING_COPY.describedDone,
      chips: ['Looks right'],
    });
  });

  it.each([
    [
      undefined,
      ONBOARDING_COPY.readingDone.replace('{n}', '12'),
      ['Looks right'],
    ],
    [
      'blocked' as const,
      ONBOARDING_COPY.problems.blocked.replace('{domain}', 'sunrise.example'),
      ['Upload documents', 'Describe it instead'],
    ],
  ])('says how reading went (%s)', async (problem, text, chips) => {
    const h = harness();
    await h.session.crawlFinished('draft-1', {
      read: 12,
      domain: 'sunrise.example',
      problem,
    });
    expect(h.store.row().transcript.slice(-1)[0]).toMatchObject({
      role: 'builder',
      text,
      chips,
    });
  });
});

describe('reading an uploaded document', () => {
  const pdf = {
    title: 'Sunrise Mind',
    fileName: 'Sunrise Mind.pdf',
    ownerChatbotId: 'bot-1',
    extracted: {
      text: 'Page one text.Fees are 2,000.',
      pages: [
        { number: 1, start: 0, end: 14 },
        { number: 2, start: 14, end: 30 },
      ],
      sections: [],
    },
  };

  it('splits a PDF into its own pages, named for the reader', () => {
    expect(documentParts('doc-1', pdf)).toEqual([
      {
        url: 'document:doc-1#page=1',
        title: 'Sunrise Mind.pdf, page 1',
        status: 'read',
        text: 'Page one text.',
      },
      {
        url: 'document:doc-1#page=2',
        title: 'Sunrise Mind.pdf, page 2',
        status: 'read',
        text: 'Fees are 2,000.',
      },
    ]);
  });

  it('splits a document without pages into parts at paragraph breaks', () => {
    const text = `${'a'.repeat(5000)}\n\n${'b'.repeat(5000)}`;
    const parts = documentParts('doc-2', {
      title: 'Policies',
      fileName: null,
      extracted: { text, pages: [] },
    });
    expect(parts.map((p) => [p.url, p.title, p.text.length])).toEqual([
      ['document:doc-2#part=1', 'Policies', 5000],
      ['document:doc-2#part=2', 'Policies', 5000],
    ]);
  });

  it('sources each detail to the document and page, and drops one that cites no page', async () => {
    const h = harness({ learned: { facts: [], dropped: 0 } });
    h.documents.readForOnboarding.mockResolvedValue(pdf);
    h.ai.extractOnboardingFacts.mockResolvedValue({
      facts: [
        {
          section: 'services',
          text: 'Sessions cost ₹2,000.',
          source_url: 'document:doc-1#page=2',
          source_title: 'Sunrise Mind.pdf, page 2',
        },
        {
          section: 'about',
          text: 'Founded in 1990.',
          source_url: 'https://sunrise.example/',
          source_title: '',
        },
      ],
      dropped: 0,
      findings: ['Found your services and prices'],
    });
    await h.session.learnFromDocument('draft-1', 'doc-1');
    const row = h.store.row();
    expect(row.learned.facts).toEqual([
      expect.objectContaining({
        sourceUrl: 'document:doc-1#page=2',
        sourceTitle: 'Sunrise Mind.pdf, page 2',
      }),
    ]);
    expect(row.learned.dropped).toBe(1);
    expect(row.transcript.slice(-1)[0]).toMatchObject({
      text: ONBOARDING_COPY.readingDone.replace('{n}', '2'),
    });
    expect(h.store.dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('knowledgeDocumentIds'),
      ['draft-1', 'doc-1'],
    );
  });

  it('says something went wrong if reading fails, never a silent dead end', async () => {
    const h = harness();
    h.documents.readForOnboarding.mockResolvedValue(pdf);
    h.ai.extractOnboardingFacts.mockRejectedValue(new Error('upstream'));
    await expect(
      h.session.learnFromDocument('draft-1', 'doc-1'),
    ).rejects.toThrow('upstream');
    expect(h.store.row().transcript.slice(-1)[0]).toMatchObject({
      role: 'builder',
      text: ONBOARDING_COPY.problems.generic,
    });
  });

  it('refuses a document from another assistant', async () => {
    const h = harness();
    h.documents.readForOnboarding.mockResolvedValue({
      ...pdf,
      ownerChatbotId: 'someone-else',
    });
    await expect(
      h.session.learnFromDocument('draft-1', 'doc-1'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(h.ai.extractOnboardingFacts).not.toHaveBeenCalled();
  });
});

describe('the site’s brand on the draft', () => {
  it('takes an https logo and the colour, but never an http logo', async () => {
    const store = memoryDrafts();
    await store.service.applyBrand('draft-1', {
      logoUrl: 'http://sunrise.example/logo.png',
      accentColour: '#0F766E',
    });
    let branding = store.row().draftConfig.branding;
    expect(branding.logoUrl).toBeNull();
    expect(branding.accentColour).toBe('#0F766E');
    await store.service.applyBrand('draft-1', {
      logoUrl: 'https://sunrise.example/logo.png',
      accentColour: null,
    });
    branding = store.row().draftConfig.branding;
    expect(branding.logoUrl).toBe('https://sunrise.example/logo.png');
  });
});
