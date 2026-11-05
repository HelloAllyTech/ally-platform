import {ArticleQuestion} from '@/types';

export const ARTICLE_QUESTION_MARKER_ATTR = 'data-ally-question';

export type ArticleSegment =
  | {kind: 'html'; key: string; html: string}
  | {kind: 'question'; key: string; question: ArticleQuestion};

/**
 * Matches one question placeholder, capturing its id. Tolerant of attribute
 * order and quoting so it survives a round trip through the authoring editor,
 * the sanitizer and the translator.
 */
const MARKER_PATTERN = new RegExp(
  `<div\\b[^>]*\\b${ARTICLE_QUESTION_MARKER_ATTR}\\s*=\\s*["']([^"']+)["'][^>]*>\\s*</div>`,
  'gi',
);

/**
 * Split an article body into the prose blocks and the inline questions
 * between them, in reading order.
 *
 * Questions are anchored in the HTML by an empty
 * `<div data-ally-question="<id>"></div>` placeholder and carried separately
 * in `questions` — the body never holds the answer key.
 *
 * A plain string split rather than the DOM walk ally-web uses: React Native
 * has no DOMParser, and `RichText` is already tolerant of unclosed and
 * mismatched tags, so a placeholder that ended up wrapped inside a block
 * degrades to a split mid-element instead of becoming unreachable. Staying
 * reachable is the property that matters — the server counts the same
 * placeholders when deciding whether the article is finished.
 *
 * A placeholder with no matching question, and a question with no
 * placeholder, are both left out. Authoring validation rejects either, so in
 * practice this only absorbs a translated body that lost a placeholder —
 * where losing the question beats stranding the reader behind one that never
 * renders.
 */
export function splitArticleHtml(
  html: string,
  questions: ArticleQuestion[] = [],
): ArticleSegment[] {
  if (!html) return [];
  const byId = new Map(questions.map(question => [question.id, question]));
  if (byId.size === 0) {
    return [{kind: 'html', key: 'html-0', html}];
  }

  const segments: ArticleSegment[] = [];
  const seen = new Set<string>();

  const pushHtml = (value: string) => {
    if (!value || !value.trim()) return;
    segments.push({kind: 'html', key: `html-${segments.length}`, html: value});
  };

  // `split` with a capturing group yields [html, id, html, id, ..., html].
  const parts = html.split(new RegExp(MARKER_PATTERN.source, 'i'));
  parts.forEach((part, index) => {
    if (index % 2 === 0) {
      pushHtml(part);
      return;
    }
    const question = byId.get(part);
    if (!question || seen.has(part)) return;
    seen.add(part);
    segments.push({kind: 'question', key: `q-${part}`, question});
  });

  return segments;
}
