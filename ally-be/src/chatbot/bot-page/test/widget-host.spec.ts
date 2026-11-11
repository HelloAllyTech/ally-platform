import {
  cleanPageUrl,
  frameAncestors,
  hostAllowed,
  normaliseDomain,
} from '../widget-host';

const DEV = { production: false };
const PROD = { production: true };

/** Where the website widget may open (chunk 13). */
describe('widget hosts', () => {
  describe('normaliseDomain', () => {
    it('keeps only the domain: no scheme, www, path, port or capitals', () => {
      for (const input of [
        'sunrisemind.in',
        'https://www.SunriseMind.in/contact?x=1',
        'http://sunrisemind.in:8080',
        ' www.sunrisemind.in. ',
      ]) {
        expect(normaliseDomain(input, PROD)).toEqual({
          domain: 'sunrisemind.in',
        });
      }
    });

    it('refuses what is not a website address', () => {
      for (const input of [
        '',
        'not a site',
        'sunrisemind',
        '10.0.0.1',
        '-x.in',
      ]) {
        expect(normaliseDomain(input, PROD)).toMatchObject({
          refused: 'invalid',
        });
      }
    });

    it('refuses public suffixes and shared hosting domains as bare entries', () => {
      for (const input of [
        'co.in',
        'blogspot.com',
        'github.io',
        'vercel.app',
        'netlify.app',
        'wixsite.com',
        'myshopify.com',
        'https://www.wixsite.com/',
      ]) {
        expect(normaliseDomain(input, PROD)).toMatchObject({
          refused: 'shared',
        });
      }
    });

    it('accepts a site of its own on a shared host', () => {
      expect(normaliseDomain('myclinic.wixsite.com', PROD)).toEqual({
        domain: 'myclinic.wixsite.com',
      });
      expect(normaliseDomain('https://myclinic.github.io/', PROD)).toEqual({
        domain: 'myclinic.github.io',
      });
    });

    it('allows localhost and 127.0.0.1 only outside production', () => {
      expect(normaliseDomain('localhost', DEV)).toEqual({
        domain: 'localhost',
      });
      expect(normaliseDomain('http://127.0.0.1:5500', DEV)).toEqual({
        domain: '127.0.0.1',
      });
      expect(normaliseDomain('localhost', PROD)).toMatchObject({
        refused: 'local',
      });
      expect(normaliseDomain('127.0.0.1', PROD)).toMatchObject({
        refused: 'local',
      });
    });
  });

  describe('hostAllowed', () => {
    const allowed = ['sunrisemind.in', 'myclinic.wixsite.com'];

    it('matches the domain, www and subdomains', () => {
      for (const origin of [
        'https://sunrisemind.in',
        'https://www.sunrisemind.in',
        'https://book.sunrisemind.in:8443',
        'https://myclinic.wixsite.com',
      ]) {
        expect(hostAllowed(allowed, origin, PROD)).toBe(true);
      }
    });

    it('never matches a look-alike, a sibling on a shared host, or nothing', () => {
      for (const origin of [
        'https://evil-sunrisemind.in',
        'https://sunrisemind.in.evil.com',
        'https://other.wixsite.com',
        'https://wixsite.com',
        'file:///tmp/x.html',
        'null',
        '',
        undefined,
      ]) {
        expect(hostAllowed(allowed, origin, PROD)).toBe(false);
      }
    });

    it('ignores a stored entry that is shared, or local in production', () => {
      expect(hostAllowed(['github.io'], 'https://anyone.github.io', PROD)).toBe(
        false,
      );
      expect(hostAllowed(['localhost'], 'http://localhost:5500', PROD)).toBe(
        false,
      );
      expect(hostAllowed(['localhost'], 'http://localhost:5500', DEV)).toBe(
        true,
      );
    });
  });

  it('keeps the page without its query or fragment, and only on the host', () => {
    const host = 'https://sunrisemind.in';
    expect(cleanPageUrl('https://sunrisemind.in/fees?utm=x#top', host)).toBe(
      'https://sunrisemind.in/fees',
    );
    expect(cleanPageUrl('https://elsewhere.com/fees', host)).toBeNull();
    expect(cleanPageUrl('not a url', host)).toBeNull();
    expect(cleanPageUrl(undefined, host)).toBeNull();
  });

  it('builds frame-ancestors from the allowed websites and Ally’s page', () => {
    expect(
      frameAncestors(
        ['sunrisemind.in', 'github.io'],
        'https://chat.helloally.ai',
        PROD,
      ),
    ).toBe(
      "frame-ancestors 'self' https://chat.helloally.ai https://sunrisemind.in https://*.sunrisemind.in",
    );
  });
});
