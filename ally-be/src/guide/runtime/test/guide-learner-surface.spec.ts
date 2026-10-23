import { NotFoundException } from '@nestjs/common';
import { SessionItemStatus } from 'src/common/type/common.type';
import { TrackItemType } from 'src/track/type/track.type';
import { buildCourseSpine } from '../../conductor/course-spine';
import {
  GuideCardKind,
  GuideCardState,
  GuideMode,
} from '../../enum/guide.enum';
import {
  GUIDE_DEFAULT_BUNDLE,
  GUIDE_DEFAULT_POLICY,
} from '../../release/guide-release.bundle';
import { GuideCardService } from '../guide-card.service';
import { GuideProgressListener } from '../guide-progress.listener';
import {
  DEFAULT_GUIDE_PREFS,
  GuideViewService,
  cardView,
  nextStepFor,
  spineView,
} from '../guide-view.service';

const spine = buildCourseSpine(
  {
    id: 'tr1',
    title: 'Course',
    enrolled: true,
    sections: [
      {
        id: 's1',
        title: 'Starting well',
        order: 1,
        items: [
          {
            id: 'i1',
            type: TrackItemType.ARTICLE,
            order: 1,
            title: 'Listening',
            status: SessionItemStatus.COMPLETED,
          },
          {
            id: 'i2',
            type: TrackItemType.ROLEPLAY,
            order: 2,
            title: 'Meera calls',
            status: SessionItemStatus.UNLOCKED,
          },
        ],
      },
    ],
  },
  { triggerWarningsByItem: new Map([['i2', ['Suicide']]]) },
);

describe('spineView and nextStepFor', () => {
  it('draws the Spine with states, minutes and warnings', () => {
    const view = spineView(spine);
    expect(view).toMatchObject({
      completed: 1,
      total: 2,
      currentItemId: 'i2',
      finished: false,
    });
    expect(
      view.sections[0].items.map((i) => [i.id, i.state, i.boss, i.hasWarnings]),
    ).toEqual([
      ['i1', 'completed', false, false],
      ['i2', 'available', true, true],
    ]);
  });

  it('shows the dock normally and hides it in CARE', () => {
    expect(nextStepFor(spine, null, GUIDE_DEFAULT_POLICY)).toEqual({
      hidden: false,
      itemId: 'i2',
      title: 'Meera calls',
      minutes: 12,
    });
    expect(
      nextStepFor(
        spine,
        { mode: GuideMode.CARE, pacing: {} },
        GUIDE_DEFAULT_POLICY,
      ).hidden,
    ).toBe(true);
  });
});

describe('cardView', () => {
  it('restores the card as presented, with its current state', () => {
    const presented = {
      cardId: 'c1',
      kind: 'course_item',
      presentation: 'theatre',
      state: 'ready',
      title: 'Meera calls',
      framing: 'Your first call.',
    };
    expect(
      cardView({
        id: 'c1',
        kind: 'course_item',
        presentation: 'theatre',
        state: 'done',
        title: 'x',
        payload: { card: presented },
      } as never),
    ).toEqual({ ...presented, state: 'done' });
  });
});

describe('GuideViewService.bootstrap', () => {
  function service(
    options: { reason?: string | null; hasAccess?: boolean; thread?: any } = {},
  ) {
    const settings = {
      unavailableReason: jest.fn(async () => options.reason ?? null),
      switches: jest.fn(async () => ({ anonymousChat: false, voice: true })),
    };
    const enrollment = {
      getTrackAccess: jest.fn(async () => ({
        hasAccess: options.hasAccess ?? true,
        enrolled: true,
        reason: options.hasAccess === false ? 'NOT_IN_GROUP' : null,
      })),
    };
    const localization = {
      listLearnerLanguages: jest.fn(async () => [
        { languageCode: 'en' },
        { languageCode: 'hi' },
      ]),
    };
    const conductor = {
      loadCourse: jest.fn(async () => ({
        title: 'Course',
        description: null,
        languageCode: 'en',
        trainerNotes: null,
        spine,
      })),
    };
    const releases = {
      getGa: jest.fn(async () => ({ bundle: GUIDE_DEFAULT_BUNDLE })),
    };
    const repo = (findOne: any, find: any = []) => ({
      findOne: jest.fn(async () => findOne),
      find: jest.fn(async () => find),
      save: jest.fn(async (row: any) => row),
    });
    return new GuideViewService(
      settings as never,
      enrollment as never,
      localization as never,
      conductor as never,
      releases as never,
      repo(options.thread ?? null) as never,
      repo(null, [
        {
          id: 'm2',
          seq: 2,
          role: 'ally',
          kind: 'chat',
          content: 'Hello.',
          createdAt: new Date('2026-10-23T10:00:00Z'),
          turnId: 't1',
        },
        {
          id: 'm1',
          seq: 1,
          role: 'learner',
          kind: 'chat',
          content: 'Hi',
          createdAt: new Date('2026-10-23T09:59:00Z'),
          turnId: 't1',
        },
      ]) as never,
      repo(null, [
        {
          id: 'c1',
          kind: 'course_item',
          presentation: 'theatre',
          state: 'ready',
          title: 'Meera calls',
          presentedSeq: 4,
          payload: {
            card: {
              cardId: 'c1',
              kind: 'course_item',
              presentation: 'theatre',
              state: 'ready',
              title: 'Meera calls',
            },
          },
        },
        {
          id: 'c0',
          kind: 'resource',
          presentation: 'inline',
          state: 'ready',
          title: 'never shown',
          presentedSeq: null,
        },
      ]) as never,
      repo({ prefs: { guidance: 'drive' } }) as never,
      repo({ coverImageUrl: null }) as never,
    );
  }
  const user = { id: 3, tenantId: 'org', username: 'x' };

  it('says why when the guide is off, and stops there', async () => {
    const result = await service({ reason: 'switched_off' }).bootstrap(
      'tr1',
      user,
    );
    expect(result.availability).toMatchObject({
      guided: false,
      reason: 'switched_off',
      languages: ['en', 'hi'],
    });
    expect(result.access).toBeUndefined();
    expect(result.prefs).toEqual({ ...DEFAULT_GUIDE_PREFS, guidance: 'drive' });
  });

  it('returns the access answer without course data when access is refused', async () => {
    const result = await service({ hasAccess: false }).bootstrap('tr1', user);
    expect(result.access).toEqual({
      hasAccess: false,
      enrolled: true,
      reason: 'NOT_IN_GROUP',
    });
    expect(result.spine).toBeUndefined();
  });

  it('draws everything for a learner with a thread', async () => {
    const result = await service({
      thread: {
        id: 'th1',
        mode: 'NORMAL',
        pacing: {},
        lastEventSeq: 9,
        languageCode: 'en',
      },
    }).bootstrap('tr1', user);
    expect(result.course).toMatchObject({
      title: 'Course',
      estimatedMinutes: 18,
    });
    expect(result.thread).toMatchObject({
      id: 'th1',
      lastEventSeq: 9,
      atmosphere: 'hushed',
    });
    expect(result.messages.map((m) => m.text)).toEqual(['Hi', 'Hello.']);
    expect(result.cards).toEqual([
      {
        seq: 4,
        card: expect.objectContaining({ cardId: 'c1', state: 'ready' }),
      },
    ]);
    expect(result.nextStep).toMatchObject({ itemId: 'i2', hidden: false });
  });
});

describe('GuideCardService', () => {
  function setup(card: any, completed = false) {
    const cards = {
      findOne: jest.fn(async () => card),
      update: jest.fn(async () => undefined),
    };
    const threads = { saveState: jest.fn(async () => undefined) };
    const bus = { appendDurable: jest.fn(async () => ({ seq: 1 })) };
    const dataSource = {
      query: jest.fn(async () => [
        { status: completed ? 'COMPLETED' : 'UNLOCKED' },
      ]),
    };
    const service = new GuideCardService(
      dataSource as never,
      threads as never,
      bus as never,
      { set: jest.fn(), get: jest.fn(), del: jest.fn() } as never,
      cards as never,
    );
    return { service, cards, threads, bus };
  }
  const thread = {
    id: 'th1',
    trackId: 'tr1',
    userId: 3,
    pacing: { offSpineTurns: 5 },
  } as never;
  const itemCard = {
    id: 'c1',
    kind: GuideCardKind.COURSE_ITEM,
    state: GuideCardState.READY,
    trackItemId: 'i2',
  };

  it('opening an item makes the card active and resets the off-course count', async () => {
    const t = setup(itemCard);
    expect(await t.service.handle(thread, 'c1', { type: 'opened' })).toEqual({
      cardId: 'c1',
      state: GuideCardState.ACTIVE,
    });
    expect(t.threads.saveState).toHaveBeenCalledWith('th1', {
      pacing: expect.objectContaining({ offSpineTurns: 0 }),
    });
    expect(t.bus.appendDurable).toHaveBeenCalledWith('th1', 'card.updated', {
      cardId: 'c1',
      state: GuideCardState.ACTIVE,
    });
  });

  it('accepts a completion claim only when classic progress agrees', async () => {
    const refused = setup(itemCard, false);
    expect(
      await refused.service.handle(thread, 'c1', { type: 'completed_claim' }),
    ).toEqual({
      cardId: 'c1',
      state: GuideCardState.READY,
      verified: false,
    });
    expect(refused.cards.update).not.toHaveBeenCalled();

    const accepted = setup(itemCard, true);
    expect(
      await accepted.service.handle(thread, 'c1', { type: 'completed_claim' }),
    ).toMatchObject({
      state: GuideCardState.DONE,
      verified: true,
    });
  });

  it('answers 404 for a card from another thread', async () => {
    await expect(
      setup(null).service.handle(thread, 'c9', { type: 'opened' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('GuideProgressListener', () => {
  const event = {
    userId: 3,
    tenantId: 'org',
    trackId: 'tr1',
    trackEnrollmentId: 'enr1',
    trackItemId: 'i2',
    trackSectionId: 's1',
    itemType: 'ROLEPLAY',
  };

  function setup(options: { duplicate?: boolean; present?: boolean } = {}) {
    const queries: string[] = [];
    const dataSource = {
      query: jest.fn(async (sql: string) => {
        queries.push(sql);
        if (sql.includes('INSERT INTO "guide_triggers"')) {
          return options.duplicate ? [[], 0] : [[{ id: 'trg-1' }], 1];
        }
        if (sql.includes('UPDATE "guide_cards"')) return [[{ id: 'c1' }], 1];
        return [];
      }),
    };
    const threadService = { saveState: jest.fn(async () => undefined) };
    const bus = {
      appendDurable: jest.fn<Promise<{ seq: number }>, [string, string, any]>(
        async () => ({ seq: 1 }),
      ),
    };
    const conductor = {
      loadCourse: jest.fn(async () => ({ spine })),
    };
    const cards = { isPresent: jest.fn(async () => options.present ?? false) };
    const turns = {
      acceptTrigger: jest.fn(async () => ({ turnId: 't', created: true })),
    };
    const threads = {
      find: jest.fn(async () => [
        {
          id: 'th1',
          userId: 3,
          tenantId: 'org',
          mode: GuideMode.NORMAL,
          pacing: { learnerTurns: 4 },
        },
      ]),
      update: jest.fn(),
    };
    const listener = new GuideProgressListener(
      dataSource as never,
      threadService as never,
      bus as never,
      conductor as never,
      cards as never,
      turns as never,
      threads as never,
    );
    return { listener, bus, threadService, turns, queries };
  }

  it('marks the card done, moves the Spine, opens the release window and celebrates the practice', async () => {
    const t = setup();
    await t.listener.onItemCompleted(event);
    const types = t.bus.appendDurable.mock.calls.map((call: any[]) => call[1]);
    expect(types).toEqual(['card.updated', 'spine.updated', 'milestone']);
    // A hard item with content warnings: hushed, so the celebration is quiet.
    expect(t.bus.appendDurable.mock.calls[2][2]).toMatchObject({
      kind: 'boss_complete',
      tone: 'quiet',
    });
    expect(t.threadService.saveState).toHaveBeenCalledWith('th1', {
      pacing: expect.objectContaining({
        releaseWindow: { itemId: 'i2', openedAtTurn: 4 },
      }),
    });
    expect(t.turns.acceptTrigger).not.toHaveBeenCalled();
  });

  it('starts a turn when the learner is watching', async () => {
    const t = setup({ present: true });
    await t.listener.onItemCompleted(event);
    expect(t.turns.acceptTrigger).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'th1' }),
      { id: 3, tenantId: 'org' },
      {
        dedupeKey: 'item_completed:enr1:i2',
        description: 'The learner completed "Meera calls" (roleplay).',
      },
    );
  });

  it('does nothing for an event it has already handled', async () => {
    const t = setup({ duplicate: true });
    await t.listener.onItemCompleted(event);
    expect(t.bus.appendDurable).not.toHaveBeenCalled();
    expect(t.threadService.saveState).not.toHaveBeenCalled();
  });
});
