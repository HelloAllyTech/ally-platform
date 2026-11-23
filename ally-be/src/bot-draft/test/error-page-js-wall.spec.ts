import { looksLikeErrorPage } from '../crawl/error-page';

describe('looksLikeErrorPage: pages that only ask for JavaScript (SB1)', () => {
  it.each([
    'This page requires JavaScript to view.',
    'To view this website, enable JavaScript in your browser settings and reload the page.',
    'You need to enable JavaScript to run this app.',
    'JavaScript is required to use this site.',
  ])('treats "%s" as a page with nothing to read', (text) => {
    expect(looksLikeErrorPage('Ally for Mental Health', text)).toBe(true);
  });

  it('still reads a long real page that mentions JavaScript', () => {
    const text = `${'We teach web development. '.repeat(80)} JavaScript is required for our course.`;
    expect(looksLikeErrorPage('Courses', text)).toBe(false);
  });

  it('still reads a short real page that does not ask for JavaScript', () => {
    expect(
      looksLikeErrorPage(
        'Contact',
        'Call us on 98200 12345, 9 to 6 on weekdays.',
      ),
    ).toBe(false);
  });
});
