jest.mock('@/store/store', () => ({
  store: {dispatch: jest.fn(), getState: jest.fn(() => ({}))},
}));
jest.mock('@/store/slices/userSlice', () => ({
  handleLogout: jest.fn(),
  storeTokens: jest.fn(),
}));
jest.mock('@/utils/asyncStorage', () => ({
  getItem: jest.fn(async () => undefined),
}));
jest.mock('@/config/env', () => ({
  env: {API_BASE_URL: 'https://example.com', API_VERSION: 'v1'},
}));

import {
  getReactionAction,
  getReactionsArray,
  getTopReactions,
  getTotalReactionCount,
  splitByCommentRanges,
} from '../reviews';

describe('splitByCommentRanges', () => {
  it('returns whole text as one segment when ranges empty', () => {
    expect(splitByCommentRanges('hello', [])).toEqual([
      {text: 'hello', commentIds: [], start: 0, end: 5},
    ]);
  });

  it('drops invalid ranges (end <= start) and returns full text', () => {
    expect(
      splitByCommentRanges('ab', [
        {id: '1', start: 1, end: 1},
        {id: '2', start: 2, end: 0},
      ]),
    ).toEqual([{text: 'ab', commentIds: [], start: 0, end: 2}]);
  });

  it('clamps range indices to message bounds', () => {
    const segs = splitByCommentRanges('hi', [{id: 'a', start: -99, end: 99}]);
    expect(segs.some(s => s.commentIds.includes('a'))).toBe(true);
    expect(segs.map(s => s.text).join('')).toBe('hi');
  });

  it('splits on boundaries and assigns overlapping comment ids', () => {
    const segs = splitByCommentRanges('abcdef', [
      {id: 'x', start: 0, end: 3},
      {id: 'y', start: 2, end: 6},
    ]);
    const withX = segs.find(s => s.text === 'ab');
    const overlap = segs.find(s => s.text === 'c');
    expect(withX?.commentIds).toEqual(['x']);
    expect(overlap?.commentIds.sort()).toEqual(['x', 'y'].sort());
  });

  it('merges consecutive segments with same commentIds', () => {
    const segs = splitByCommentRanges('abcd', [
      {id: 'only', start: 0, end: 4},
    ]);
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({
      text: 'abcd',
      commentIds: ['only'],
      start: 0,
      end: 4,
    });
  });
});

describe('getTopReactions', () => {
  it('sorts by count descending and maps to codes', () => {
    expect(
      getTopReactions({a: 1, b: 9, c: 5}),
    ).toEqual(['b', 'c', 'a']);
  });

  it('respects limit', () => {
    expect(getTopReactions({x: 1, y: 2, z: 3}, 2)).toEqual(['z', 'y']);
  });

  it('returns empty for empty record', () => {
    expect(getTopReactions({})).toEqual([]);
  });
});

describe('getReactionsArray', () => {
  it('returns empty array when reactions undefined', () => {
    expect(getReactionsArray(undefined)).toEqual([]);
  });

  it('filters zero counts and maps known keys to unicode', () => {
    expect(
      getReactionsArray({'1f44d': 2, '2764-fe0f': 0, UNKNOWN: 1}),
    ).toEqual(['👍', '❤']);
  });

  it('lowercase keys match map', () => {
    expect(getReactionsArray({'1F44D': 1})).toEqual(['👍']);
  });
});

describe('getTotalReactionCount', () => {
  it('returns 0 when undefined', () => {
    expect(getTotalReactionCount(undefined)).toBe(0);
  });

  it('sums positive counts', () => {
    expect(getTotalReactionCount({a: 2, b: 3})).toBe(5);
  });
});

describe('getReactionAction', () => {
  it('ADD when no current emoji', () => {
    expect(getReactionAction(null, '👍')).toBe('ADD');
  });

  it('UPDATE when current differs', () => {
    expect(getReactionAction('👎', '👍')).toBe('UPDATE');
  });

  it('REMOVE when current equals unicode', () => {
    expect(getReactionAction('❤️', '❤️')).toBe('REMOVE');
  });
});
