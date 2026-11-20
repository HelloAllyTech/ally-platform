import { findStyleIssues } from '../util/blog-style-check.util';

const kinds = (p: Parameters<typeof findStyleIssues>[0]) =>
  findStyleIssues(p).map((i) => `${i.kind}:${i.where}`);

describe('findStyleIssues', () => {
  it('is clean for plain, descriptive writing', () => {
    expect(
      findStyleIssues({
        title: 'How Ally writes feedback after a practice call',
        tldr: 'After a practice call, an AI assistant reads the transcript and drafts a note for the learner.',
        body: '<h2>What the learner sees</h2><p>A short note, with their own words quoted.</p>',
      }),
    ).toEqual([]);
  });

  it('flags sections about what is not done or what went wrong', () => {
    for (const h of [
      'What is not done yet',
      'What we have not measured yet',
      'What went wrong first',
      'Lessons learned',
      'Limitations',
    ]) {
      expect(kinds({ body: `<h2>${h}</h2><p>x</p>` })).toContain(
        'retrospective_heading:heading',
      );
    }
  });

  it('flags internal words an outsider cannot read, in the title, tldr and body', () => {
    const found = findStyleIssues({
      title: 'A fixed floor of code',
      tldr: 'A planner picks the extras.',
      body: '<p>Tier 0 is the style card and tier 1 the sections. The risk cue goes to the evaluator.</p>',
    }).filter((i) => i.kind === 'internal_term');
    const text = found.map((i) => i.why).join(' ');
    for (const term of [
      'fixed floor',
      'planner',
      'tier 0',
      'tier 1',
      'risk cue',
      'evaluator',
    ]) {
      expect(text).toContain(`"${term}"`);
    }
    expect(found.map((i) => i.where)).toEqual(
      expect.arrayContaining(['title', 'tldr', 'body']),
    );
  });

  it('does not flag a word that only contains an internal word', () => {
    expect(
      findStyleIssues({ body: '<p>The planners of the city met.</p>' }).filter(
        (i) => i.kind === 'internal_term',
      ),
    ).toEqual([]);
  });

  it('flags lines that read as unproven claims', () => {
    for (const line of [
      "Ally's AI clients now speak Tamil the way people actually talk.",
      'It is the first product of its kind.',
      'The note gets better every week.',
      'A safe, natural-sounding reply.',
      'A seamless experience.',
    ]) {
      expect(kinds({ tldr: line })).toContain('unproven_claim:tldr');
    }
  });

  it('flags a dash used for an aside', () => {
    expect(
      kinds({ body: '<p>The agent — a program — reads it.</p>' }),
    ).toContain('aside_dash:body');
  });
});
