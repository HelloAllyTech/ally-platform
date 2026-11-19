import { BUILDER_GITHUB_FILE_MAX_BYTES } from '../../constants/builder.constants';
import {
  matchingLines,
  searchTerms,
  sliceFileLines,
} from '../builder-github-lines.util';

describe('github line helpers', () => {
  const text = ['one', 'two', 'three', 'four', 'five'].join('\n');

  it('reads a range of lines', () => {
    expect(sliceFileLines(text, { startLine: 2, endLine: 3 })).toMatchObject({
      content: 'two\nthree',
      startLine: 2,
      endLine: 3,
      totalLines: 5,
      truncated: false,
    });
  });

  it('stops at the byte cap on a whole line and says where to read on', () => {
    const line = 'x'.repeat(999);
    const big = Array.from({ length: 200 }, () => line).join('\n');
    const result = sliceFileLines(big);
    expect(result.truncated).toBe(true);
    expect(Buffer.byteLength(result.content)).toBeLessThanOrEqual(
      BUILDER_GITHUB_FILE_MAX_BYTES,
    );
    expect(result.note).toContain(`startLine=${result.endLine + 1}`);
    const next = sliceFileLines(big, { startLine: result.endLine + 1 });
    expect(next.startLine).toBe(result.endLine + 1);
  });

  it('finds matching lines from highlighted search text', () => {
    const terms = searchTerms('computeReadiness repo:x', [
      { text_matches: [{ matches: [{ text: 'computeReadiness' }] }] },
    ]);
    expect(terms).toEqual(['computereadiness']);
    expect(matchingLines('a\n  computeReadiness(draft)\nb', terms)).toEqual([
      { line: 2, text: 'computeReadiness(draft)' },
    ]);
  });

  it('falls back to the query words, without qualifiers', () => {
    expect(searchTerms('"roadmap item" extension:md', [])).toEqual([
      'roadmap',
      'item',
    ]);
  });
});
