import { ExtractedDocument } from 'src/knowledge-base/extractor';
import { segmentDocument, skipReasonFor, tailTokens } from '../segment.util';

function doc(sections: Array<[string, string]>): ExtractedDocument {
  let text = '';
  const spans: ExtractedDocument['sections'] = [];
  for (const [path, body] of sections) {
    const start = text.length;
    text += `${body}\n\n`;
    spans.push({ path, start, end: text.length });
  }
  return { text, pages: [], sections: spans };
}

const paragraph = (seed: string, n = 60) =>
  Array.from(
    { length: n },
    (_, i) => `${seed} sentence number ${i} explains one more idea.`,
  ).join(' ');

describe('segmentDocument', () => {
  it('follows headings and marks boilerplate as skipped', () => {
    const segments = segmentDocument(
      doc([
        ['Contents', 'Introduction ..... 1\nLists ..... 4'],
        ['Guide › Introduction', paragraph('intro')],
        ['Guide › Lists › Empty states', paragraph('lists')],
        ['Guide › About the authors', paragraph('people', 5)],
      ]),
    );
    const byPath = (p: string) => segments.filter((s) => s.sectionPath === p);
    expect(byPath('Contents')[0].skippedReason).toBe('contents');
    expect(byPath('Guide › About the authors')[0].skippedReason).toBe(
      'contributors',
    );
    expect(
      byPath('Guide › Lists › Empty states').every(
        (s) => s.skippedReason === null,
      ),
    ).toBe(true);
  });

  it("gives each extractable segment the previous one's tail as context, never a skipped one", () => {
    const segments = segmentDocument(
      doc([
        ['Guide › Introduction', paragraph('intro')],
        ['Index', 'a, b, c'],
        ['Guide › Lists', paragraph('lists')],
      ]),
    );
    const lists = segments.find((s) => s.sectionPath === 'Guide › Lists')!;
    expect(lists.leadIn).toContain('intro sentence');
    expect(lists.leadIn).not.toContain('a, b, c');
  });

  it('marks opening and closing material for the overview pass', () => {
    const segments = segmentDocument(
      doc([
        ['Guide › Introduction', paragraph('intro')],
        ['Guide › Lists', paragraph('lists')],
        ['Guide › Conclusion', paragraph('end')],
      ]),
    );
    const marked = segments
      .filter((s) => s.forOverview)
      .map((s) => s.sectionPath);
    expect(marked).toEqual(
      expect.arrayContaining(['Guide › Introduction', 'Guide › Conclusion']),
    );
    expect(marked).not.toContain('Guide › Lists');
  });

  it('hashes each segment so a re-drop can resume', () => {
    const [s] = segmentDocument(doc([['A', paragraph('a', 5)]]));
    expect(s.textHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('skipReasonFor', () => {
  it('only looks at the leaf heading', () => {
    expect(skipReasonFor('Licence terms › Using the guide')).toBeNull();
    expect(skipReasonFor('Back matter › Licence')).toBe('legal');
    expect(skipReasonFor(null)).toBeNull();
  });
});

describe('tailTokens', () => {
  it('keeps the end of the text within the budget', () => {
    const tail = tailTokens(paragraph('x', 100), 20);
    expect(tail.length).toBeGreaterThan(0);
    expect(tail.split(/\s+/).length).toBeLessThan(25);
  });
});
