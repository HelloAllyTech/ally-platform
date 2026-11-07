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
} from '../service/bot-draft-session.service';
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
  const session = new BotDraftSessionService(
    store.service,
    store.events as never,
    ai as never,
  );
  const emitted: SessionEvent[] = [];
  const turn = (input: { text?: string; chip?: string }) =>
    session.turn(store.row(), input, (e) => emitted.push(e));
  return { store, ai, session, emitted, turn };
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
    expect(h.store.events.publish).toHaveBeenCalledWith('draft-1', {
      type: 'finding',
      text: 'Found your opening hours',
    });
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
