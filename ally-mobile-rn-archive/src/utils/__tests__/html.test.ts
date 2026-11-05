import {htmlToMultilineText, htmlToPlainText} from '../html';

describe('htmlToPlainText', () => {
  it('returns empty string for nullish or empty input', () => {
    expect(htmlToPlainText(undefined)).toBe('');
    expect(htmlToPlainText(null)).toBe('');
    expect(htmlToPlainText('')).toBe('');
  });

  it('passes plain text through unchanged', () => {
    expect(htmlToPlainText('Hello world')).toBe('Hello world');
  });

  it('strips simple tags and preserves word boundaries between block elements', () => {
    expect(htmlToPlainText('<p>Hello <strong>world</strong></p>')).toBe(
      'Hello world',
    );
    expect(htmlToPlainText('<p>a</p><p>b</p>')).toBe('a b');
  });

  it('drops script and style bodies entirely', () => {
    expect(
      htmlToPlainText('Hi<script>alert("x")</script> there'),
    ).toBe('Hi there');
    expect(
      htmlToPlainText('Hi<style>body{color:red}</style> there'),
    ).toBe('Hi there');
  });

  it('flattens lists and headings into readable text', () => {
    expect(
      htmlToPlainText(
        "<h3>What's hard</h3><ul><li>Defensiveness</li><li>Avoidance</li></ul>",
      ),
    ).toBe("What's hard Defensiveness Avoidance");
  });

  it('decodes named HTML entities', () => {
    expect(htmlToPlainText('Tom &amp; Jerry')).toBe('Tom & Jerry');
    expect(htmlToPlainText('&lt;tag&gt;')).toBe('<tag>');
    expect(htmlToPlainText('&quot;quoted&quot;')).toBe('"quoted"');
    expect(htmlToPlainText('it&apos;s')).toBe("it's");
    expect(htmlToPlainText('a&nbsp;b')).toBe('a b');
  });

  it('decodes numeric and hex HTML entities', () => {
    expect(htmlToPlainText('it&#39;s')).toBe("it's");
    expect(htmlToPlainText('it&#x27;s')).toBe("it's");
  });

  it('leaves unknown entities intact', () => {
    expect(htmlToPlainText('&zzz;')).toBe('&zzz;');
  });

  it('collapses runs of whitespace and trims the result', () => {
    expect(htmlToPlainText('  <p>  a   b  </p>  ')).toBe('a b');
  });
});

describe('htmlToMultilineText', () => {
  it('returns empty string for nullish or empty input', () => {
    expect(htmlToMultilineText(undefined)).toBe('');
    expect(htmlToMultilineText('<p></p>')).toBe('');
  });

  it('keeps paragraph and <br> breaks from a rich-text course description', () => {
    expect(
      htmlToMultilineText(
        '<p>This is a short micro-course.<br /><br />This short module will take you 30-40 minutes.</p>',
      ),
    ).toBe(
      'This is a short micro-course.\n\nThis short module will take you 30-40 minutes.',
    );
    expect(htmlToMultilineText('<p>a</p><p>b &amp; c</p>')).toBe('a\nb & c');
  });

  it('renders list items as bullets', () => {
    expect(htmlToMultilineText('<ul><li>One</li><li>Two</li></ul>')).toBe(
      '• One\n• Two',
    );
  });
});
