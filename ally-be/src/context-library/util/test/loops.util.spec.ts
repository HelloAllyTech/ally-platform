import {
  ClChunkConfidence,
  ClChunkOrigin,
  ClJudgmentSplit,
  ClLoopActionType,
} from '../../enum/context-library.enum';
import {
  CuratorStats,
  challengerWins,
  curatorDecision,
  effectivenessScore,
  gradeFromJudge,
  greedyClusters,
  ndcgAt,
  neverUseful,
  positionWeight,
  recallAt,
  splitForQuery,
} from '../loops.util';

const stats = (over: Partial<CuratorStats> = {}): CuratorStats => ({
  origin: ClChunkOrigin.DISTILLED,
  confidence: ClChunkConfidence.STANDARD,
  pinned: false,
  surfaced: 40,
  judged: 10,
  judgedOffTopic: 7,
  judgedUseful: 3,
  applied: 0,
  cited: 0,
  ...over,
});

describe('splitForQuery', () => {
  it('is stable for the same wording, whatever the order or case', () => {
    expect(splitForQuery(['B thing', 'a thing'])).toBe(
      splitForQuery(['a THING', 'b thing ']),
    );
  });

  it('sends roughly one in five wordings to the holdout', () => {
    const splits = Array.from({ length: 2000 }, (_, i) =>
      splitForQuery([`query number ${i}`]),
    );
    const share =
      splits.filter((s) => s === ClJudgmentSplit.HOLDOUT).length /
      splits.length;
    expect(share).toBeGreaterThan(0.15);
    expect(share).toBeLessThan(0.25);
  });
});

describe('gradeFromJudge', () => {
  it('maps the judge labels to 0–3, one lower for a vocabulary-only match', () => {
    expect(gradeFromJudge('relevant', false)).toBe(3);
    expect(gradeFromJudge('relevant', true)).toBe(2);
    expect(gradeFromJudge('tangential', false)).toBe(1);
    expect(gradeFromJudge('irrelevant', false)).toBe(0);
    expect(gradeFromJudge('anything else', false)).toBe(0);
  });
});

describe('ndcgAt and recallAt', () => {
  const grades = new Map([
    ['a', 3],
    ['b', 2],
    ['c', 0],
  ]);

  it('is 1 for the ideal order and lower when the best is buried', () => {
    expect(ndcgAt(['a', 'b', 'c'], grades, 8)).toBeCloseTo(1);
    expect(ndcgAt(['c', 'b', 'a'], grades, 8)).toBeLessThan(0.8);
  });

  it('is 0 when nothing judged was useful', () => {
    expect(ndcgAt(['x'], new Map([['x', 0]]), 8)).toBe(0);
  });

  it('measures recall over judged-useful items only, and says when it cannot', () => {
    expect(recallAt(['a', 'z'], grades, 50)).toBe(0.5);
    expect(recallAt(['a'], new Map([['a', 1]]), 50)).toBeNull();
  });
});

describe('effectiveness', () => {
  it('sits at the prior with no evidence and moves with use', () => {
    expect(effectivenessScore(0, 0)).toBeCloseTo(0.3);
    expect(effectivenessScore(10, 10)).toBeGreaterThan(0.6);
    expect(effectivenessScore(0, 50)).toBeLessThan(0.1);
  });

  it('weighs an unused showing at position 1 more than one at position 8', () => {
    expect(positionWeight(1)).toBeGreaterThan(positionWeight(8));
  });
});

describe('curatorDecision', () => {
  it('archives a distilled chunk that is shown often, judged off-topic and never applied', () => {
    expect(curatorDecision(stats())?.action).toBe(ClLoopActionType.ARCHIVE);
  });

  it('never touches written, imported, synced or pinned chunks', () => {
    for (const origin of [
      ClChunkOrigin.AUTHORED,
      ClChunkOrigin.IMPORTED,
      ClChunkOrigin.SYNCED,
    ]) {
      expect(curatorDecision(stats({ origin }))).toBeNull();
    }
    expect(curatorDecision(stats({ pinned: true }))).toBeNull();
  });

  it('waits for enough evidence', () => {
    expect(curatorDecision(stats({ surfaced: 10 }))).toBeNull();
    expect(curatorDecision(stats({ judged: 2, judgedOffTopic: 2 }))).toBeNull();
  });

  it('keeps a chunk that was applied, however it was judged', () => {
    expect(curatorDecision(stats({ applied: 1 }))?.action).not.toBe(
      ClLoopActionType.ARCHIVE,
    );
  });

  it('promotes a low-confidence chunk that keeps being applied', () => {
    expect(
      curatorDecision(
        stats({
          confidence: ClChunkConfidence.LOW,
          applied: 3,
          judgedOffTopic: 0,
          judgedUseful: 10,
        }),
      )?.action,
    ).toBe(ClLoopActionType.PROMOTE);
  });

  it('demotes an on-topic chunk nobody ever uses', () => {
    expect(
      curatorDecision(stats({ judgedOffTopic: 2, judgedUseful: 8 }))?.action,
    ).toBe(ClLoopActionType.DEMOTE);
  });
});

describe('neverUseful', () => {
  it('reports written entries for their owners but never distilled ones', () => {
    expect(neverUseful(stats({ origin: ClChunkOrigin.AUTHORED }))).toBe(true);
    expect(neverUseful(stats())).toBe(false);
    expect(
      neverUseful(stats({ origin: ClChunkOrigin.AUTHORED, cited: 1 })),
    ).toBe(false);
  });
});

describe('challengerWins', () => {
  it('needs a clear nDCG gain and no recall loss', () => {
    const live = { ndcg: 0.6, recall: 0.8 };
    expect(challengerWins(live, { ndcg: 0.63, recall: 0.8 })).toBe(true);
    expect(challengerWins(live, { ndcg: 0.61, recall: 0.9 })).toBe(false);
    expect(challengerWins(live, { ndcg: 0.7, recall: 0.79 })).toBe(false);
  });
});

describe('greedyClusters', () => {
  it('groups near vectors and keeps far ones apart', () => {
    const clusters = greedyClusters(
      [
        [1, 0],
        [0.99, 0.05],
        [0, 1],
      ],
      0.9,
    );
    expect(clusters).toEqual([[0, 1], [2]]);
  });
});
