import { retitled } from '../roadmap-item-query.util';

describe('backfill-roadmap-idea-titles retitled()', () => {
  it('keeps the whole of a single-block idea as its Problem (OPP-0648)', () => {
    const original =
      'Reduce latency further: As learners in live roleplay sessions, faster turn responses are being lost — so that turns are slower. Possible approach: fix one issue at a time.';
    expect(retitled(original, 'Fix prompt caching and the RAG cache key')).toBe(
      `Fix prompt caching and the RAG cache key\n\n${original}`,
    );
  });

  it('replaces the title line of an idea that already has a body, keeping the body', () => {
    expect(retitled('Old title\n\nThe body text.', 'New title')).toBe(
      'New title\n\nThe body text.',
    );
  });

  it('treats a title line with no body as a single block', () => {
    expect(retitled('Add dark mode\n', 'Dark mode for the admin console')).toBe(
      'Dark mode for the admin console\n\nAdd dark mode',
    );
  });
});
