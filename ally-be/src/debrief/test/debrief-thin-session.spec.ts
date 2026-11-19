import {
  THIN_SESSION,
  isThinSession,
} from '../constants/debrief-release.constants';
import { sessionForGraph } from '../service/debrief-runner.service';

describe('a thin session: too little said to coach on', () => {
  it('is thin below the minimum turns or the minimum words, and only then', () => {
    const { minLearnerTurns: t, minLearnerWords: w } = THIN_SESSION;
    expect(isThinSession(t - 1, 500)).toBe(true);
    expect(isThinSession(20, w - 1)).toBe(true);
    expect(isThinSession(t, w)).toBe(false);
    expect(isThinSession(t + 5, w + 100)).toBe(false);
  });

  it('holds the cases measured on production (learner turns, learner words)', () => {
    // thin: one turn and 3 words; 3 turns and 8 words; 2 and 9; 2 and 27 (the Kabir session)
    for (const [turns, words] of [
      [1, 3],
      [3, 8],
      [2, 9],
      [2, 27],
    ]) {
      expect(isThinSession(turns, words)).toBe(true);
    }
    // not thin: 4 turns and 89 words; 6 and 40
    expect(isThinSession(4, 89)).toBe(false);
    expect(isThinSession(6, 40)).toBe(false);
  });

  it('is sent to the graph as a flag, with the words it was judged on', () => {
    const base = {
      id: 's',
      tenantId: null,
      counselorId: 1,
      status: 'ENDED',
      language: 'en',
      learnerLevel: 'x',
      scenarioId: 5,
      scenario: { title: 't', description: 'd' },
      expectedBehaviours: [],
      assessment: false,
      inCase: false,
    } as any;
    const thin = sessionForGraph({
      ...base,
      learnerTurns: 2,
      learnerWords: 27,
    });
    expect(thin).toMatchObject({ thin: true, learner_words: 27 });
    const fine = sessionForGraph({
      ...base,
      learnerTurns: 8,
      learnerWords: 150,
    });
    expect(fine).toMatchObject({ thin: false, learner_words: 150 });
  });
});
