import {splitArticleHtml} from '../articleSegments';

import {ArticleQuestion} from '@/types';

const question = (id: string): ArticleQuestion => ({
  id,
  type: 'mcq_single',
  prompt: `Prompt ${id}`,
  points: 1,
  options: [
    {id: 'a', text: 'A'},
    {id: 'b', text: 'B'},
  ],
  answered: null,
  correctOptionId: null,
  explanation: null,
});

const marker = (id: string) => `<div data-ally-question="${id}"></div>`;

describe('splitArticleHtml', () => {
  it('returns the whole body as one segment when there are no questions', () => {
    expect(splitArticleHtml('<p>Just prose</p>')).toEqual([
      {kind: 'html', key: 'html-0', html: '<p>Just prose</p>'},
    ]);
  });

  it('splits the body at each placeholder, in reading order', () => {
    const segments = splitArticleHtml(
      `<p>One</p>${marker('q1')}<p>Two</p>${marker('q2')}<p>Three</p>`,
      [question('q1'), question('q2')],
    );

    expect(segments.map(s => s.kind)).toEqual([
      'html',
      'question',
      'html',
      'question',
      'html',
    ]);
    expect(
      segments
        .filter(s => s.kind === 'question')
        .map(s => (s as {question: ArticleQuestion}).question.id),
    ).toEqual(['q1', 'q2']);
  });

  it('orders questions by the placeholders, not by the questions array', () => {
    const segments = splitArticleHtml(`${marker('q2')}${marker('q1')}`, [
      question('q1'),
      question('q2'),
    ]);
    expect(
      segments.map(s => (s as {question: ArticleQuestion}).question.id),
    ).toEqual(['q2', 'q1']);
  });

  it('emits a leading placeholder with no prose before it', () => {
    const segments = splitArticleHtml(`${marker('q1')}<p>After</p>`, [
      question('q1'),
    ]);
    expect(segments.map(s => s.kind)).toEqual(['question', 'html']);
  });

  it('drops a placeholder whose question is missing', () => {
    const segments = splitArticleHtml(
      `<p>One</p>${marker('ghost')}<p>Two</p>`,
      [question('q1')],
    );
    expect(segments.every(s => s.kind === 'html')).toBe(true);
    expect(
      segments.map(s => (s as {html: string}).html).join(''),
    ).toContain('Two');
  });

  it('drops a question whose placeholder is missing', () => {
    const segments = splitArticleHtml(`<p>One</p>${marker('q1')}`, [
      question('q1'),
      question('q2'),
    ]);
    expect(segments.filter(s => s.kind === 'question')).toHaveLength(1);
  });

  it('emits the same placeholder only once', () => {
    const segments = splitArticleHtml(
      `${marker('q1')}<p>x</p>${marker('q1')}`,
      [question('q1')],
    );
    expect(segments.filter(s => s.kind === 'question')).toHaveLength(1);
  });

  it('skips whitespace-only prose segments', () => {
    const segments = splitArticleHtml(`${marker('q1')}   ${marker('q2')}`, [
      question('q1'),
      question('q2'),
    ]);
    expect(segments.map(s => s.kind)).toEqual(['question', 'question']);
  });

  it('tolerates single quotes and extra attributes on the placeholder', () => {
    const segments = splitArticleHtml(
      `<p>a</p><div class="chip" data-ally-question='q1'></div>`,
      [question('q1')],
    );
    expect(segments.map(s => s.kind)).toEqual(['html', 'question']);
  });

  /**
   * A translated body can come back with the placeholder wrapped. RichText is
   * tolerant of unclosed tags, so splitting mid-element is an acceptable
   * degradation — the question staying reachable is what matters, since the
   * server counts the same placeholders when deciding the article is done.
   */
  it('keeps a nested placeholder reachable', () => {
    const segments = splitArticleHtml(
      `<blockquote>Quote${marker('q1')}</blockquote>`,
      [question('q1')],
    );
    expect(segments.filter(s => s.kind === 'question')).toHaveLength(1);
    expect(
      segments.map(s => (s.kind === 'html' ? s.html : '')).join(''),
    ).not.toContain('data-ally-question');
  });
});
