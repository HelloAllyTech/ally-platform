import { readable, toHex, commonColour, detectBrand } from '../crawl/brand';
import { decodeEntities, mainContent, parsePage } from '../crawl/page-parser';
import { parseRobots } from '../crawl/robots';
import { parseSitemap } from '../crawl/sitemap';
import {
  isJunk,
  normaliseUrl,
  sameSite,
  siteKey,
  startUrlFrom,
} from '../crawl/url-scope';

describe('robots.txt', () => {
  const robots = parseRobots(`
User-agent: *
Disallow: /private
Allow: /private/ok
Disallow: /*.pdf$
Sitemap: https://s.example/sitemap.xml

User-agent: AllyAssistantSetup
Disallow: /team
`);

  it('uses our own group when one names us, else *', () => {
    expect(robots.allows('/team')).toBe(false);
    expect(robots.allows('/private')).toBe(true); // our group doesn't disallow it
    const star = parseRobots(
      'User-agent: *\nDisallow: /private\nAllow: /private/ok\nDisallow: /*.pdf$',
    );
    expect(star.allows('/private/x')).toBe(false);
    expect(star.allows('/private/ok/page')).toBe(true); // longest match wins
    expect(star.allows('/files/a.pdf')).toBe(false);
    expect(star.allows('/files/a.pdf?x=1')).toBe(true);
  });

  it('lists sitemaps, and treats an empty Disallow (or no file) as allowing everything', () => {
    expect(robots.sitemaps).toEqual(['https://s.example/sitemap.xml']);
    expect(parseRobots('User-agent: *\nDisallow:').allows('/anything')).toBe(
      true,
    );
    expect(parseRobots('').allows('/')).toBe(true);
    expect(parseRobots('User-agent: *\nDisallow: /').allows('/')).toBe(false);
  });
});

describe('url scope', () => {
  it('normalises: no fragment, no tracking, no trailing slash', () => {
    expect(
      normaliseUrl('https://Www.S.example/About/?utm_source=x&b=2&a=1#team'),
    ).toBe('https://www.s.example/About?a=1&b=2');
    expect(normaliseUrl('mailto:hi@s.example')).toBeNull();
    expect(startUrlFrom('sunrisemind.example')).toBe(
      'https://sunrisemind.example/',
    );
  });

  it('keeps to the registrable domain', () => {
    expect(
      sameSite('https://www.s.example/a', 'https://blog.s.example/b'),
    ).toBe(true);
    expect(sameSite('https://s.example/a', 'https://other.example/b')).toBe(
      false,
    );
    expect(siteKey('https://clinic.co.in/x')).toBe('clinic.co.in');
    expect(sameSite('https://a.clinic.co.in', 'https://b.other.co.in')).toBe(
      false,
    );
    expect(sameSite('http://localhost:8701/', 'http://localhost:8702/')).toBe(
      false,
    );
  });

  it.each([
    '/login',
    '/cart',
    '/wp-admin/x',
    '/tag/news',
    '/logo.png',
    '/feed',
    '/brochure.pdf',
  ])('skips %s', (path) => {
    expect(isJunk(`https://s.example${path}`)).toBe(true);
  });

  it('keeps ordinary pages', () => {
    expect(isJunk('https://s.example/services/couples-therapy')).toBe(false);
  });
});

describe('page parser', () => {
  const html = `<!doctype html><html><head><title> Fees | Sunrise Mind </title>
    <link rel="canonical" href="/fees"><link rel="icon" href="/fav.ico"><link rel="apple-touch-icon" href="/touch.png">
    <link rel="stylesheet" href="/site.css"><meta name="theme-color" content="#0f766e"><meta property="og:image" content="/og.png">
    <style>.btn{color:#0F766E}</style><script>var a=1</script></head>
    <body><header><img class="site-logo" src="/logo.svg"><nav><a href="/team">Team</a></nav></header>
    <main><h1>Fees</h1><p>Individual sessions are ₹1,800.</p><h2>Couples</h2><p>Couples sessions are ₹2,500.</p><a href="/contact">Contact</a></main>
    <footer>© Sunrise</footer></body></html>`;

  it('reads the title, head metadata, links and logo', () => {
    const page = parsePage(html);
    expect(page.title).toBe('Fees | Sunrise Mind');
    expect(page.canonical).toBe('/fees');
    expect(page.meta.themeColor).toBe('#0f766e');
    expect(page.meta.ogImage).toBe('/og.png');
    expect(page.icons).toEqual({ appleTouch: '/touch.png', icon: '/fav.ico' });
    expect(page.logo).toBe('/logo.svg');
    expect(page.links).toEqual(['/team', '/contact']);
    expect(page.stylesheets).toEqual(['/site.css']);
    expect(page.scriptCount).toBe(1);
  });

  it('takes the main content only, with its headings', () => {
    const page = parsePage(html);
    expect(page.text).toContain('Couples sessions are ₹2,500.');
    expect(page.text).not.toContain('© Sunrise');
    expect(page.headings).toEqual(['Fees', 'Couples']);
    expect(
      mainContent(
        '<body><nav>menu</nav><p>Body text</p><footer>f</footer></body>',
      ),
    ).not.toContain('menu');
  });
});

describe('brand', () => {
  it('reads colours in any common form, ignoring greys', () => {
    expect(toHex('#abc')).toBe('#AABBCC');
    expect(toHex('rgb(15, 118, 110)')).toBe('#0F766E');
    expect(
      commonColour(
        'a{color:#333}b{color:#0f766e}c{background:#0f766e}d{color:#fff}',
      ),
    ).toBe('#0F766E');
  });

  it('darkens a colour that would not read on the page, or drops it', () => {
    expect(readable('#0F766E')).toBe('#0F766E');
    const light = readable('#FFD966');
    expect(light).not.toBe('#FFD966');
    expect(light === null || /^#[0-9A-F]{6}$/.test(light)).toBe(true);
  });

  it('prefers og:image for the logo and theme-color for the colour', () => {
    const brand = detectBrand(
      parsePage(
        '<head><meta name="theme-color" content="#0f766e"><meta property="og:image" content="/og.png"></head>',
      ),
      'https://s.example/',
      [],
    );
    expect(brand).toEqual({
      logoUrl: 'https://s.example/og.png',
      accentColour: '#0F766E',
      faviconUrl: 'https://s.example/favicon.ico',
    });
  });
});

describe('sitemap', () => {
  it('reads a urlset and a sitemap index', () => {
    expect(
      parseSitemap(
        '<urlset><url><loc>https://s.example/a</loc></url><url><loc>https://s.example/b</loc></url></urlset>',
      ).pages,
    ).toEqual(['https://s.example/a', 'https://s.example/b']);
    expect(
      parseSitemap(
        '<sitemapindex><sitemap><loc>https://s.example/s1.xml</loc></sitemap></sitemapindex>',
      ).sitemaps,
    ).toEqual(['https://s.example/s1.xml']);
    expect(parseSitemap('not xml <')).toEqual({ pages: [], sitemaps: [] });
  });
});

describe('decodeEntities', () => {
  it('decodes what a page title carries', () => {
    expect(
      decodeEntities(
        'Research &amp; Survey &#8211; Live&nbsp;Love &#x2019;Laugh&rsquo;',
      ),
    ).toBe('Research & Survey – Live Love ’Laugh’');
    expect(decodeEntities('&bogus; &#0;')).toBe('&bogus; &#0;');
  });
});
