import { remapGuideNotesItems } from '../track-guide-notes.util';

describe('remapGuideNotesItems', () => {
  it('re-points tension at the copy item ids and drops unmapped ids', () => {
    const remapped = remapGuideNotesItems(
      {
        notes: 'Go gently in chapter 2.',
        tension: { 'old-a': 'high', 'old-gone': 'low' },
        draftedByCopilot: true,
      },
      new Map([['old-a', 'new-a']]),
    );

    expect(remapped).toEqual({
      notes: 'Go gently in chapter 2.',
      tension: { 'new-a': 'high' },
      draftedByCopilot: true,
    });
  });

  it('leaves notes without tension untouched', () => {
    expect(remapGuideNotesItems({ notes: 'x' }, new Map())).toEqual({
      notes: 'x',
    });
  });

  it('does not mutate its input', () => {
    const input = { tension: { a: 'low' as const } };
    remapGuideNotesItems(input, new Map([['a', 'b']]));
    expect(input).toEqual({ tension: { a: 'low' } });
  });
});
