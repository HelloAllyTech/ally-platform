import { GuideSideQuestService } from '../guide-side-quest.service';

function setup(card: any) {
  const updates: any[] = [];
  const cards = {
    findOne: jest.fn(async () => card),
    update: jest.fn(async (_id: string, patch: any) => updates.push(patch)),
  };
  const coach = {
    note: jest.fn(async () => 'You reflected first; try a pause next.'),
  };
  const threads = {
    saveState: jest.fn(async () => undefined),
    queueTrigger: jest.fn(async () => true),
  };
  const bus = { appendDurable: jest.fn(async () => ({ seq: 1 })) };
  const service = new GuideSideQuestService(
    cards as never,
    {} as never,
    coach as never,
    {} as never,
    threads as never,
    bus as never,
  );
  return { service, updates, threads, bus, coach };
}

const thread: any = { id: 'th1', tenantId: 'org', pacing: { learnerTurns: 4 } };
const call = (s: GuideSideQuestService, body: any) =>
  s.respond({
    thread,
    cardId: 'c1',
    languageCode: 'en',
    bundle: {} as never,
    attribution: {},
    ...body,
  });

const assessorCard = {
  id: 'c1',
  kind: 'micro_activity',
  state: 'ready',
  payload: {
    kind: 'quick_check',
    card: { cardId: 'c1' },
    spec: {
      source: 'assessor',
      activity: {
        kind: 'quick_check',
        title: 'Silence',
        intro: '',
        questions: [
          {
            id: 'q1',
            prompt: 'p',
            sourceItemId: 'i1',
            options: [
              { id: 'a', text: 'A', correct: true, feedback: 'yes' },
              { id: 'b', text: 'B', correct: false, feedback: 'no' },
              { id: 'c', text: 'C', correct: false, feedback: 'no' },
            ],
          },
        ],
      },
    },
  },
};

describe('GuideSideQuestService.respond', () => {
  it('marks a quick check, completes the card, feeds difficulty and tells Ally — no progress or XP', async () => {
    const t = setup(assessorCard);
    const result = await call(t.service, {
      answers: [{ questionId: 'q1', optionId: 'a' }],
    });
    expect(result.results?.[0]).toMatchObject({ correct: true });
    expect(t.updates[0].state).toBe('done');
    expect(t.bus.appendDurable).toHaveBeenCalledWith('th1', 'card.updated', {
      cardId: 'c1',
      state: 'done',
    });
    expect(t.threads.saveState).toHaveBeenCalledWith('th1', {
      pacing: expect.objectContaining({
        sideQuest: { answered: 1, correct: 1 },
      }),
    });
    expect(t.threads.queueTrigger).toHaveBeenCalledWith(
      thread,
      expect.objectContaining({ kind: 'side_quest_done' }),
    );
  });

  it('gives a written answer one Coach note', async () => {
    const t = setup({
      ...assessorCard,
      payload: {
        kind: 'rehearse_line',
        spec: {
          source: 'coach',
          activity: {
            kind: 'rehearse_line',
            title: 'Opening',
            prompt: 'How would you open?',
            placeholder: '',
            focus: null,
          },
        },
      },
    });
    const result = await call(t.service, { text: 'Hi, I am here to listen.' });
    expect(result.note).toContain('reflected first');
    expect(t.coach.note).toHaveBeenCalled();
  });

  it('refuses a done card, an empty answer, or a card from another thread', async () => {
    await expect(
      call(setup({ ...assessorCard, state: 'done' }).service, {
        answers: [{ questionId: 'q1', optionId: 'a' }],
      }),
    ).rejects.toThrow('already done');
    await expect(call(setup(assessorCard).service, {})).rejects.toThrow(
      'Choose an answer',
    );
    await expect(
      call(setup(null).service, {
        answers: [{ questionId: 'q1', optionId: 'a' }],
      }),
    ).rejects.toThrow('not found');
  });
});
