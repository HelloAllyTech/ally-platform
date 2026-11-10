import { extractCitations, stripCodes } from '../context-citation.service';

describe('citations', () => {
  it('finds single and grouped codes', () => {
    const text =
      'Design the empty state first [FP-0142]. Keep tips short [FP-0011, LD-0031].';
    expect(extractCitations(text).map((c) => c.code)).toEqual([
      'FP-0142',
      'FP-0011',
      'LD-0031',
    ]);
  });

  it('ignores things that only look like codes', () => {
    expect(extractCitations('[TODO] see [FP-12] and [fp-0142]')).toEqual([]);
  });

  it('strips invented codes and drops brackets left empty', () => {
    const text = 'One [FP-0142]. Two [FP-9999, FP-0011]. Three [FP-9999].';
    expect(stripCodes(text, new Set(['FP-9999']))).toBe(
      'One [FP-0142]. Two [FP-0011]. Three .',
    );
  });
});
