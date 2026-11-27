import { snippetToPlainText } from '../service/manual-plain-text';
import { escapeHtml } from '../service/manual-search.service';

describe('snippetToPlainText', () => {
  it('strips <mark> and decodes the escaper’s entities', () => {
    expect(
      snippetToPlainText(
        'a <mark>&quot;new badge&quot;</mark> &amp; &lt;b&gt; it&#39;s',
      ),
    ).toBe(`a "new badge" & <b> it's`);
  });

  it('decodes once, so escaped entity text stays literal', () => {
    expect(snippetToPlainText('&amp;lt; not a tag')).toBe('&lt; not a tag');
  });

  it('round-trips whatever the search service escaped', () => {
    const raw = `Tom's "quick" <fix> & more`;
    expect(snippetToPlainText(escapeHtml(raw))).toBe(raw);
  });

  it('copes with empty input', () => {
    expect(snippetToPlainText(undefined)).toBe('');
  });
});
