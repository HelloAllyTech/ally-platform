import { RoadmapNotificationKind as K } from '../../enum/product-planning.enum';
import { RoadmapIdeaNoticeService } from '../roadmap-idea-notice.service';

const SESSION = 'sess-1';
const ITEM = 'item-1';

function build(
  opts: {
    planner?: number | null;
    lead?: number | null;
    shared?: boolean;
    started?: boolean;
    firstReady?: boolean;
  } = {},
) {
  const inbox = {
    deliver: jest.fn(async (_event: Record<string, unknown>) => [1]),
    deliverComment: jest.fn(async () => [1]),
    markItemRead: jest.fn(async () => 1),
  };
  const query = jest.fn(async (sql: string) => {
    if (sql.includes('planReadyNoticeAt'))
      return opts.firstReady === false ? [] : [{ id: SESSION }];
    if (sql.includes('JOIN "roadmap_opportunities" o'))
      return [
        {
          itemId: ITEM,
          code: 'OPP-0001',
          visibility: opts.shared === false ? 'private' : 'shared',
          leadUserId: opts.lead ?? null,
          planningStarted: opts.started === false ? 'false' : 'true',
          plannerUserId: opts.planner === undefined ? '3' : opts.planner,
        },
      ];
    return [];
  });
  const service = new RoadmapIdeaNoticeService(
    inbox as never,
    { query } as never,
  );
  return { service, inbox, query };
}

describe('RoadmapIdeaNoticeService (idea-to-plan audit recs 8 and 10)', () => {
  it('sends a problem-or-user question to the author, with the planner', async () => {
    const { service, inbox } = build();
    await service.questionsAsked(SESSION, [
      { id: 'q1', prompt: 'Who hits this most?', forAuthor: true },
    ]);
    expect(inbox.deliver).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: K.AGENT_QUESTION,
        itemId: ITEM,
        directRecipientIds: [3],
        payload: expect.objectContaining({ forAuthor: true, questionId: 'q1' }),
      }),
    );
    expect(inbox.deliver.mock.calls[0][0]).not.toHaveProperty('onlyDirect');
  });

  it('sends any other question only to the planner, or the lead once there is one', async () => {
    const { service, inbox } = build({ lead: 6 });
    await service.questionsAsked(SESSION, [{ id: 'q2', prompt: 'Which tab?' }]);
    expect(inbox.deliver).toHaveBeenCalledWith(
      expect.objectContaining({ directRecipientIds: [6], onlyDirect: true }),
    );
  });

  it('says nothing for a private draft or before planning starts', async () => {
    for (const opts of [{ shared: false }, { started: false }]) {
      const { service, inbox } = build(opts);
      await service.questionsAsked(SESSION, [{ id: 'q', forAuthor: true }]);
      expect(inbox.deliver).not.toHaveBeenCalled();
    }
  });

  it('sends plan-ready once, on the first ready stage only', async () => {
    const first = build();
    await first.service.stageEntered(SESSION, 'prd');
    expect(first.inbox.deliver).not.toHaveBeenCalled();
    await first.service.stageEntered(SESSION, 'design');
    expect(first.inbox.deliver).toHaveBeenCalledWith(
      expect.objectContaining({ kind: K.PLAN_READY, itemId: ITEM }),
    );
    const again = build({ firstReady: false });
    await again.service.stageEntered(SESSION, 'ready');
    expect(again.inbox.deliver).not.toHaveBeenCalled();
  });

  it('starts planning with an accepted notice that names how', async () => {
    const { service, inbox } = build();
    await service.planningStarted({
      actorUserId: 3,
      itemId: ITEM,
      code: 'OPP-0001',
      sessionId: SESSION,
      acceptedNow: false,
    });
    expect(inbox.deliver).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: K.ACCEPTED,
        actorUserId: 3,
        payload: expect.objectContaining({
          via: 'start_planning',
          alreadyAccepted: true,
        }),
      }),
    );
  });

  it('groups comments and leaves out the people mentioned', async () => {
    const { service, inbox } = build();
    await service.commented({
      sessionId: SESSION,
      itemId: ITEM,
      code: 'OPP-0001',
      actorUserId: 5,
      postId: 'p1',
      mentionedIds: [7],
    });
    expect(inbox.deliverComment).toHaveBeenCalledWith(
      expect.objectContaining({ itemId: ITEM, excludeRecipientIds: [7] }),
    );
  });

  it('reads the notices on open and stamps the author’s first look', async () => {
    const { service, inbox, query } = build();
    await service.opened(1, ITEM);
    expect(inbox.markItemRead).toHaveBeenCalledWith(1, ITEM);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('authorOpenedPlanAt'),
      [ITEM, 1],
    );
  });

  it('never throws', async () => {
    const { service, inbox } = build();
    inbox.deliver.mockRejectedValueOnce(new Error('db down'));
    await expect(
      service.planClosed({
        actorUserId: 3,
        itemId: ITEM,
        code: 'X',
        sessionId: SESSION,
      }),
    ).resolves.toBeUndefined();
  });
});
