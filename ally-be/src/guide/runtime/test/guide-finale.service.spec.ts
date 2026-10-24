import { SessionItemStatus } from 'src/common/type/common.type';
import { TrackItemType } from 'src/track/type/track.type';
import { buildCourseSpine } from '../../conductor/course-spine';
import { GuideMode } from '../../enum/guide.enum';
import {
  FINALE_COPY,
  GuideFinaleService,
  buildFinalePayload,
  finaleHostingNote,
  finaleTone,
  isHeavyCourse,
} from '../guide-finale.service';

const course = (warnings: Record<string, string[]> = {}) =>
  buildCourseSpine(
    {
      id: 'tr1',
      title: 'Foundations',
      enrolled: true,
      sections: [
        {
          id: 's1',
          title: 'One',
          order: 1,
          items: [
            {
              id: 'a1',
              type: TrackItemType.ARTICLE,
              order: 1,
              title: 'Listening',
              status: SessionItemStatus.COMPLETED,
            },
            {
              id: 'a2',
              type: TrackItemType.ARTICLE,
              order: 2,
              title: 'Silence',
              status: SessionItemStatus.COMPLETED,
            },
            {
              id: 'a3',
              type: TrackItemType.ARTICLE,
              order: 3,
              title: 'Questions',
              status: SessionItemStatus.COMPLETED,
            },
            {
              id: 'r1',
              type: TrackItemType.ROLEPLAY,
              order: 4,
              title: 'Meera calls',
              status: SessionItemStatus.COMPLETED,
            },
            {
              id: 'a4',
              type: TrackItemType.ARTICLE,
              order: 5,
              title: 'Endings',
              status: SessionItemStatus.COMPLETED,
            },
          ],
        },
      ],
    },
    { triggerWarningsByItem: new Map(Object.entries(warnings)) },
  );

describe('the finale’s tone', () => {
  it('is festive for an ordinary course', () => {
    expect(isHeavyCourse(course())).toBe(false);
    expect(finaleTone({ spine: course(), mode: GuideMode.NORMAL })).toBe(
      'festive',
    );
  });

  it('is hushed when a practice carries warnings', () => {
    expect(isHeavyCourse(course({ r1: ['Suicide'] }))).toBe(true);
  });

  it('is hushed when a quarter of the course carries warnings, not before', () => {
    expect(isHeavyCourse(course({ a1: ['Grief'] }))).toBe(false);
    expect(isHeavyCourse(course({ a1: ['Grief'], a2: ['Abuse'] }))).toBe(true);
  });

  it('is hushed in a hard moment', () => {
    expect(finaleTone({ spine: course(), mode: GuideMode.CARE })).toBe('quiet');
  });
});

describe('buildFinalePayload', () => {
  const now = new Date('2026-10-24T10:00:00.000Z');

  it('puts the first move beside an invitation, revisits the possible self, and opens three doors', () => {
    const payload = buildFinalePayload({
      hushed: false,
      firstMove: {
        text: 'I would tell her it gets better',
        question: 'Meera says she can’t cope. What do you say first?',
      },
      possibleSelf: 'Someone people feel safe with',
      noticings: ['You let the silence sit (roleplay)'],
      watchFor: 'the moment a caller goes quiet',
      now,
    });
    expect(payload.firstMove).toEqual({
      text: 'I would tell her it gets better',
      question: 'Meera says she can’t cope. What do you say first?',
      invitation: FINALE_COPY.firstMove,
    });
    expect(payload.possibleSelf?.text).toBe('Someone people feel safe with');
    expect(payload.noticings).toEqual(['You let the silence sit (roleplay)']);
    expect(payload.doors.map((door) => door.kind)).toEqual([
      'field_assignment',
      'spaced_recall',
      'mentor',
    ]);
    expect(payload.doors[0].body).toContain(
      'watch for this: the moment a caller goes quiet.',
    );
    // Spaced recall: an appointment seven days out.
    expect(payload.doors[1].suggestedAt).toBe('2026-10-31T10:00:00.000Z');
    // The mentor door stays shut until advice lines exist.
    expect(payload.doors[2]).toMatchObject({ maxChars: 200, available: false });
    expect(JSON.stringify(payload)).not.toMatch(/score|%/i);
  });

  it('leaves out what has nothing behind it', () => {
    const payload = buildFinalePayload({
      hushed: true,
      firstMove: null,
      possibleSelf: '  ',
      noticings: [],
      watchFor: null,
      now,
    });
    expect(payload).toMatchObject({
      hushed: true,
      firstMove: null,
      possibleSelf: null,
      noticings: [],
    });
    expect(payload.doors[0].body).toBe(FINALE_COPY.fieldDefault);
  });

  it('tells Ally to host it plainly when hushed, and to invite the first move again', () => {
    const note = finaleHostingNote(
      buildFinalePayload({
        hushed: true,
        firstMove: { text: 'I would listen', question: null },
        possibleSelf: null,
        noticings: [],
        watchFor: null,
        now,
      }),
    );
    expect(note).toContain('invite them to answer their first move again');
    expect(note).toContain('keep it quiet and plain');
  });
});

describe('GuideFinaleService', () => {
  function setup(options: { shown?: boolean } = {}) {
    const dataSource = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes(`"question"`)) {
          return [
            {
              text: 'I would tell her it gets better',
              question: 'What do you say?',
            },
          ];
        }
        if (sql.includes(`'watchFor'`)) return [{ watchFor: 'the quiet' }];
        if (sql.includes('guide_notebook_entries')) {
          return [{ text: 'Someone people feel safe with' }];
        }
        return [];
      }),
    };
    const bus = {
      appendDurable: jest.fn(async () => ({ seq: 21 })),
    };
    const cards = {
      count: jest.fn(async () => (options.shown ? 1 : 0)),
      create: jest.fn((row: any) => row),
      save: jest.fn(async (row: any) => ({ id: 'f1', ...row })),
      update: jest.fn<Promise<void>, any[]>(async () => undefined),
      findOne: jest.fn(),
    };
    const service = new GuideFinaleService(
      dataSource as never,
      bus as never,
      cards as never,
    );
    return { service, bus, cards };
  }
  const thread = {
    id: 'th1',
    userId: 3,
    tenantId: 'org',
    trackId: 'tr1',
    mode: GuideMode.NORMAL,
  };

  it('presents a theatre card with the payload, once', async () => {
    const t = setup();
    const outcome = await t.service.present(thread, course(), 'Foundations');
    expect(outcome.presented).toBe(true);
    const saved = t.cards.save.mock.calls[0][0];
    expect(saved).toMatchObject({
      kind: 'finale',
      presentation: 'theatre',
      tone: 'festive',
      title: 'Looking back on Foundations',
    });
    expect(t.bus.appendDurable).toHaveBeenCalledWith('th1', 'card.presented', {
      card: expect.objectContaining({ kind: 'finale', cardId: 'f1' }),
    });
    expect(t.cards.update).toHaveBeenCalledWith(
      'f1',
      expect.objectContaining({ presentedSeq: 21 }),
    );

    const again = setup({ shown: true });
    expect(
      await again.service.present(thread, course(), 'Foundations'),
    ).toEqual({
      presented: false,
      reason: 'already_shown',
    });
  });

  it('waits in a crisis, and needs a finished course and a learner', async () => {
    const t = setup();
    expect(
      await t.service.present(
        { ...thread, mode: GuideMode.CRISIS },
        course(),
        'Foundations',
      ),
    ).toEqual({ presented: false, reason: 'crisis' });
    expect(
      await t.service.present(
        thread,
        { ...course(), finished: false },
        'Foundations',
      ),
    ).toEqual({ presented: false, reason: 'not_finished' });
    expect(
      await t.service.present(
        { ...thread, userId: null, tenantId: null },
        course(),
        'Foundations',
      ),
    ).toEqual({ presented: false, reason: 'visitor' });
    expect(t.cards.save).not.toHaveBeenCalled();
  });
});
