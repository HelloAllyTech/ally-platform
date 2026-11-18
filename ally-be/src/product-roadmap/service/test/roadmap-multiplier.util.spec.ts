import {
  breadthMultiplier,
  breadthTarget,
  nextDrop,
  roundPoints,
} from '../../util/roadmap-multiplier.util';

describe('breadthTarget', () => {
  it('caps at 8 and never exceeds the authors that exist', () => {
    expect(breadthTarget(20)).toBe(8);
    expect(breadthTarget(4)).toBe(4);
  });
  it('is at least 1 so the ratio is defined', () => {
    expect(breadthTarget(0)).toBe(1);
  });
});

describe('breadthMultiplier', () => {
  it.each([
    [0, 8, 1.0],
    [1, 8, 1.04],
    [4, 8, 1.15],
    [8, 8, 1.3],
    [12, 8, 1.3],
    [3, 4, 1.23],
    [0, 1, 1.0],
  ])('%i of %i colleagues -> %f', (q, t, expected) => {
    expect(breadthMultiplier(q, t)).toBe(expected);
  });
  it('never goes below 1.0', () => {
    expect(breadthMultiplier(-3, 8)).toBe(1);
  });
});

describe('nextDrop', () => {
  const d = (n: number) => new Date(Date.UTC(2026, 10, n));
  it('is null with nothing in the window', () => {
    expect(nextDrop([], 8)).toBeNull();
  });
  it('is the earliest author when below the target', () => {
    const drop = nextDrop(
      [
        { authorId: 1, at: d(20) },
        { authorId: 2, at: d(12) },
      ],
      8,
    );
    expect(drop?.authorId).toBe(2);
    expect(drop?.multiplierAfter).toBe(breadthMultiplier(1, 8));
  });
  it('skips drops that leave the count at or above the target', () => {
    const authors = Array.from({ length: 10 }, (_, i) => ({
      authorId: i,
      at: d(10 + i),
    }));
    // 10 qualifying, target 8: the first two leaving change nothing; the third lands at 7.
    const drop = nextDrop(authors, 8);
    expect(drop?.authorId).toBe(2);
    expect(drop?.multiplierAfter).toBe(breadthMultiplier(7, 8));
  });
});

describe('roundPoints', () => {
  it('rounds to one decimal', () => {
    expect(roundPoints(41.2999999)).toBe(41.3);
    expect(roundPoints(3)).toBe(3);
  });
});
