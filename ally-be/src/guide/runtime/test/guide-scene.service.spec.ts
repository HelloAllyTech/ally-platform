import { SessionItemStatus } from 'src/common/type/common.type';
import { TrackItemType } from 'src/track/type/track.type';
import { buildCourseSpine } from '../../conductor/course-spine';
import {
  GuideSceneService,
  behaviourLabel,
  sceneReceipt,
  sceneStakes,
  sceneViews,
} from '../guide-scene.service';

const spine = buildCourseSpine({
  id: 'tr1',
  title: 'Course',
  enrolled: true,
  sections: [
    {
      id: 's1',
      title: 'First steps',
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
    {
      id: 's2',
      title: 'Going deeper',
      order: 2,
      items: [
        {
          id: 'i3',
          type: TrackItemType.ARTICLE,
          order: 1,
          title: 'Reflecting',
          status: SessionItemStatus.LOCKED,
        },
      ],
    },
  ],
});

describe('scene receipts', () => {
  it('turns a noticing into its behaviour label', () => {
    expect(behaviourLabel('You let the silence sit (in the roleplay)')).toBe(
      'You let the silence sit',
    );
  });

  it('labels each behaviour once, keeps the latest noticing whole, never a score', () => {
    expect(
      sceneReceipt(
        [
          'You asked about her plan directly (debrief)',
          'You let the silence sit (roleplay)',
          'You asked about her plan directly (later)',
        ],
        2,
      ),
    ).toEqual({
      behaviourLabels: [
        'You asked about her plan directly',
        'You let the silence sit',
      ],
      sideQuests: 2,
      noticing: 'You asked about her plan directly (later)',
    });
    expect(sceneReceipt([], 0)).toEqual({
      behaviourLabels: [],
      sideQuests: 0,
      noticing: null,
    });
  });

  it('names the practice a chapter builds to as its stakes, or nothing', () => {
    expect(sceneStakes(spine, 's1')).toBe(
      'It builds to a practice: Meera calls.',
    );
    expect(sceneStakes(spine, 's2')).toBeNull();
  });

  it('lists only scene cards, by the seq they opened at', () => {
    expect(
      sceneViews([
        { id: 'c', kind: 'course_item', title: 'x', presentedSeq: 1 } as never,
        {
          id: 'b',
          kind: 'chapter_title',
          title: 'Two',
          presentedSeq: 9,
          payload: { sectionId: 's2', closedSeq: null },
        } as never,
        {
          id: 'a',
          kind: 'chapter_title',
          title: 'One',
          presentedSeq: 2,
          payload: {
            sectionId: 's1',
            closedSeq: 8,
            receipt: sceneReceipt([], 0),
          },
        } as never,
      ]).map((scene) => [scene.sceneId, scene.openedSeq, scene.closedSeq]),
    ).toEqual([
      ['a', 2, 8],
      ['b', 9, null],
    ]);
  });
});

describe('GuideSceneService', () => {
  function setup(open: any = null) {
    const emitted: Array<{ type: string; data: any }> = [];
    let seq = 10;
    const emit = jest.fn(async (type: string, data: any) => {
      emitted.push({ type, data });
      return ++seq;
    });
    const qb: any = {
      where: jest.fn(() => qb),
      andWhere: jest.fn(() => qb),
      orderBy: jest.fn(() => qb),
      limit: jest.fn(() => qb),
      getMany: jest.fn(async () => (open ? [open] : [])),
    };
    const cards = {
      createQueryBuilder: jest.fn(() => qb),
      create: jest.fn((row: any) => row),
      save: jest.fn(async (row: any) => ({ id: 'sc-new', ...row })),
      update: jest.fn<Promise<void>, any[]>(async () => undefined),
    };
    const dataSource = {
      query: jest.fn(async (sql: string) =>
        sql.includes('guide_notebook_entries')
          ? [{ text: 'You let the silence sit (roleplay)' }]
          : [{ count: 1 }],
      ),
    };
    const service = new GuideSceneService(
      dataSource as never,
      {} as never,
      cards as never,
    );
    return { service, emitted, emit, cards, dataSource };
  }
  const item = (id: string) => spine.items.find((i) => i.id === id)!;

  it('opens a chapter with its title card and remembers the seq', async () => {
    const t = setup();
    const sceneId = await t.service.enterChapterOf({
      threadId: 'th1',
      tenantId: 'org',
      spine,
      item: item('i2'),
      emit: t.emit,
    });
    expect(sceneId).toBe('sc-new');
    expect(t.emitted).toEqual([
      {
        type: 'scene.opened',
        data: {
          sceneId: 'sc-new',
          sectionId: 's1',
          title: 'First steps',
          stakes: 'It builds to a practice: Meera calls.',
        },
      },
    ]);
    expect(t.cards.update).toHaveBeenCalledWith('sc-new', { presentedSeq: 11 });
  });

  it('does nothing inside the chapter already open, or for a revisited item', async () => {
    const t = setup({
      id: 'sc1',
      threadId: 'th1',
      payload: { sectionId: 's1' },
    });
    expect(
      await t.service.enterChapterOf({
        threadId: 'th1',
        tenantId: 'org',
        spine,
        item: item('i2'),
        emit: t.emit,
      }),
    ).toBeNull();
    expect(
      await t.service.enterChapterOf({
        threadId: 'th1',
        tenantId: 'org',
        spine,
        item: item('i1'),
        emit: t.emit,
      }),
    ).toBeNull();
    expect(t.emitted).toEqual([]);
  });

  it('closes the chapter left behind before opening the next', async () => {
    const t = setup({
      id: 'sc1',
      threadId: 'th1',
      payload: { sectionId: 's1' },
    });
    await t.service.enterChapterOf({
      threadId: 'th1',
      tenantId: 'org',
      spine,
      item: item('i3'),
      emit: t.emit,
    });
    expect(t.emitted.map((e) => e.type)).toEqual([
      'scene.closed',
      'scene.opened',
    ]);
    expect(t.emitted[0].data).toEqual({
      sceneId: 'sc1',
      sectionId: 's1',
      receipt: {
        behaviourLabels: ['You let the silence sit'],
        sideQuests: 1,
        noticing: 'You let the silence sit (roleplay)',
      },
    });
    // The receipt's window is read in SQL against the scene card's own time.
    expect(t.dataSource.query.mock.calls[0][0]).toContain(
      'SELECT "createdAt" FROM "guide_cards" WHERE "id" = $3',
    );
  });

  it('closes a completed chapter only if it is the one open', async () => {
    const t = setup({
      id: 'sc1',
      threadId: 'th1',
      payload: { sectionId: 's1' },
    });
    expect(await t.service.closeChapter('th1', 's2', t.emit)).toBeNull();
    expect(await t.service.closeChapter('th1', 's1', t.emit)).toMatchObject({
      sideQuests: 1,
    });
    expect(t.cards.update).toHaveBeenCalledWith(
      'sc1',
      expect.objectContaining({
        state: 'done',
        payload: expect.objectContaining({ closedSeq: 11 }),
      }),
    );
  });
});
