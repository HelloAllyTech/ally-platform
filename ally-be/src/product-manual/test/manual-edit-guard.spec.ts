import { pageLossRefusal } from '../util/manual-edit-guard.util';

const lines = (n: number, prefix = 'Line') =>
  Array.from({ length: n }, (_, i) => `${prefix} ${i + 1}: some words here.`);
const long = lines(12).join('\n\n');

describe('pageLossRefusal', () => {
  it('lets a small page be rewritten completely', () => {
    expect(
      pageLossRefusal('A short page.\n\nTwo lines.', 'Something else.'),
    ).toBeNull();
    expect(pageLossRefusal('', 'A brand new body.')).toBeNull();
  });

  it('lets a real change to a long page through: one line, one row, an added section', () => {
    expect(
      pageLossRefusal(
        long,
        long.replace('Line 3: some', 'Line 3 (fixed): some'),
      ),
    ).toBeNull();
    expect(
      pageLossRefusal(long, `${long}\n\n## New section\n\nMore words.`),
    ).toBeNull();
    // Three of twelve lines rewritten still keeps 75%.
    const rewritten = [
      ...lines(9),
      'Changed one.',
      'Changed two.',
      'Changed three.',
    ].join('\n\n');
    expect(pageLossRefusal(long, rewritten)).toBeNull();
  });

  it('refuses a fragment sent in place of a long page (the production failure)', () => {
    const proposal =
      'Summary: An idea stays in planning while only its technical design has been drafted.\n\nDetail: A design run no longer counts as a build.\n\nPR: fix/design-run-not-a-build';
    const refusal = pageLossRefusal(long, proposal);
    expect(refusal).toMatch(/remove most of the page/);
    expect(refusal).toMatch(/WHOLE page/);
    expect(refusal).toMatch(/Never send only the changed part/);
  });

  it('refuses when more than 40% of the lines are gone, even if the length holds', () => {
    // Keeps 5 of 12 lines (42%) but pads them out to the same length.
    const padded = [...lines(5), 'x'.repeat(400)].join('\n\n');
    expect(pageLossRefusal(long, padded)).toMatch(
      /keeps only 42% of the existing lines/,
    );
  });

  it('refuses when the page loses over half its length, even if the lines survive', () => {
    const verbose = Array.from(
      { length: 10 },
      (_, i) => `Heading ${i}: ${'detail '.repeat(40)}`,
    );
    const trimmed = verbose.map((l) => l.split(':')[0] + ':');
    // Every line is rewritten, so this fails on both counts; the length figure is reported too.
    expect(pageLossRefusal(verbose.join('\n'), trimmed.join('\n'))).toMatch(
      /% of its length/,
    );
  });

  it('ignores blank lines and indentation when comparing', () => {
    const spaced = lines(12)
      .map((l) => `   ${l}   `)
      .join('\n\n\n');
    expect(pageLossRefusal(long, spaced)).toBeNull();
  });
});
