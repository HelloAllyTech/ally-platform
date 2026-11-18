/**
 * Which URLs belong to the owner's site, how they're written down, and which are never worth
 * reading. "Same site" is the registrable domain (with `www.` folded): `blog.mehta.example` and
 * `www.mehta.example` are one site. Without the public suffix list, the common two-level suffixes
 * (co.in, co.uk, …) are handled explicitly. An IP or `localhost` host is compared with its port,
 * which is what tells the local fixture sites apart.
 */
const TWO_LEVEL_SUFFIXES = new Set([
  'co.in',
  'net.in',
  'org.in',
  'gen.in',
  'firm.in',
  'ind.in',
  'ac.in',
  'edu.in',
  'res.in',
  'gov.in',
  'co.uk',
  'org.uk',
  'ac.uk',
  'gov.uk',
  'com.au',
  'net.au',
  'org.au',
  'co.nz',
  'com.sg',
  'com.my',
  'co.za',
  'com.br',
  'co.jp',
]);

const TRACKING = /^(utm_[a-z]+|gclid|fbclid|mc_cid|mc_eid|ref|_hs[a-z]+)$/i;

/** `https://Www.Mehta.example/about/?utm_source=x#team` → `https://www.mehta.example/about`. */
export function normaliseUrl(raw: string, base?: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim(), base);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  url.hash = '';
  url.hostname = url.hostname.toLowerCase();
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.replace(/\/+$/, '');
  }
  return url.toString();
}

/** What the owner typed (`mehta.example`, `www.mehta.example/`, a full URL) as a start URL. */
export function startUrlFrom(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  return normaliseUrl(withScheme);
}

export function siteKey(url: string): string {
  const parsed = new URL(url);
  const host = parsed.hostname.replace(/^www\./, '');
  if (
    host === 'localhost' ||
    /^[\d.]+$/.test(host) ||
    host.includes(':') ||
    host.endsWith('.internal')
  ) {
    return `${host}:${parsed.port}`;
  }
  const labels = host.split('.');
  const lastTwo = labels.slice(-2).join('.');
  return TWO_LEVEL_SUFFIXES.has(lastTwo) ? labels.slice(-3).join('.') : lastTwo;
}

export function sameSite(a: string, b: string): boolean {
  try {
    return siteKey(a) === siteKey(b);
  } catch {
    return false;
  }
}

/** The domain shown to the owner ("Reading mehta.example…"). */
export function displayDomain(url: string): string {
  const parsed = new URL(url);
  const host = parsed.hostname.replace(/^www\./, '');
  return parsed.port ? `${host}:${parsed.port}` : host;
}

const JUNK_PATH =
  /\/(login|log-in|signin|sign-in|signup|sign-up|register|account|my-account|cart|basket|checkout|wp-admin|wp-login|wp-json|admin|feed|rss|search|tag|tags|category|categories|author|cdn-cgi|xmlrpc)(\/|$|\.)/i;
const ASSET =
  /\.(png|jpe?g|gif|webp|svg|ico|css|js|mjs|json|xml|pdf|zip|gz|mp4|mp3|wav|webm|woff2?|ttf|eot|txt|csv|docx?|xlsx?|pptx?|dmg|exe|msi|pkg|apk|deb|rpm|iso|appimage|bin)$/i;

/** Pages never worth reading: sign-in, carts, archives, feeds and files. */
export function isJunk(url: string): boolean {
  const parsed = new URL(url);
  return (
    JUNK_PATH.test(parsed.pathname) ||
    ASSET.test(parsed.pathname) ||
    /[?&](replytocom|share|print)=/i.test(parsed.search)
  );
}

const ARTICLE_PATH =
  /\/(blog|blogs|news|newsroom|article|articles|stories|story|press|press-releases|media|insights|posts?|updates|events?|webinars?|podcasts?)(\/|$)/i;

/**
 * Blog posts, news and the like: read last, and only a few, because they say little about the
 * business itself (Shehbaz, 2026-11-08: "read them last, and at most 10").
 */
export function isArticle(url: string): boolean {
  return ARTICLE_PATH.test(new URL(url).pathname);
}

/** How many blog and news pages one crawl reads, at most. */
export const MAX_ARTICLES = 10;

const segments = (url: string): string[] =>
  new URL(url).pathname.toLowerCase().split('/').filter(Boolean);

/**
 * Which queued page to read next, as its index (-1 when the queue is empty). In order: the
 * business's own pages before blog and news; pages under the address the owner gave (they typed
 * `/mumbai`, so `/mumbai/…` first); pages the site links to before ones only its sitemap lists;
 * then the section read least so far, so one big section (a catalogue of hundreds of test pages)
 * can't fill the whole page budget. Ties keep queue order.
 */
export function nextToRead(
  queue: string[],
  seen: string[],
  startUrl: string,
  sitemapOnly: Set<string>,
): number {
  const start = segments(startUrl);
  const under = (path: string[]) => start.every((s, i) => path[i] === s);
  // A page's section: its first segment below the start address, or its first segment outside it.
  const section = (url: string) => {
    const path = segments(url);
    return under(path)
      ? `in:${path[start.length] ?? ''}`
      : `out:${path[0] ?? ''}`;
  };
  const taken = new Map<string, number>();
  for (const url of seen) {
    const key = section(url);
    taken.set(key, (taken.get(key) ?? 0) + 1);
  }
  const rank = (url: string) => [
    isArticle(url) ? 1 : 0,
    under(segments(url)) ? 0 : 1,
    sitemapOnly.has(url) ? 1 : 0,
    taken.get(section(url)) ?? 0,
  ];
  const before = (a: number[], b: number[]) => {
    const k = a.findIndex((v, i) => v !== b[i]);
    return k >= 0 && a[k] < b[k];
  };
  let best = -1;
  let bestRank: number[] = [];
  queue.forEach((url, i) => {
    const r = rank(url);
    if (best < 0 || before(r, bestRank)) {
      best = i;
      bestRank = r;
    }
  });
  return best;
}

/**
 * Which pages the owner chose (chunk 20a-2, "Choose pages"): path patterns, each a path prefix
 * on segment boundaries ("/blog" is /blog and /blog/…, not /blogroll). No includes means every
 * page; an exclude always wins. Saved on the draft and reused when the site is read again.
 */
export interface PageChoice {
  include: string[];
  exclude: string[];
}

/** The most patterns one choice holds, and the longest one. */
export const PAGE_CHOICE_LIMITS = { patterns: 100, chars: 200 };

/** A pattern as stored: a path starting with "/", no query, no trailing "/". */
export function normalisePattern(raw: string): string | null {
  const path = (raw ?? '').trim().split(/[?#]/)[0];
  if (!path.startsWith('/') || path.length > PAGE_CHOICE_LIMITS.chars) {
    return null;
  }
  const clean = path.replace(/\/+$/, '') || '/';
  return clean.toLowerCase();
}

const matches = (path: string, pattern: string): boolean =>
  pattern === '/'
    ? path === '/'
    : path === pattern || path.startsWith(`${pattern}/`);

/** Whether the owner's choice lets the crawl read `url`. */
export function chosen(url: string, choice: PageChoice | undefined): boolean {
  if (!choice) return true;
  const path = (new URL(url).pathname.replace(/\/+$/, '') || '/').toLowerCase();
  if (choice.exclude.some((p) => matches(path, p))) return false;
  return !choice.include.length || choice.include.some((p) => matches(path, p));
}

/** The section a page sits in, for grouping: its first path segment ("" for the home page). */
export function sectionOf(url: string): string {
  return (
    new URL(url).pathname.split('/').filter(Boolean)[0]?.toLowerCase() ?? ''
  );
}

/** The sections "Leave out blog and news" and "Leave out careers" leave out. */
export const SHORTCUT_SECTIONS = {
  blog: [
    'blog',
    'blogs',
    'news',
    'newsroom',
    'articles',
    'article',
    'stories',
    'press',
    'press-releases',
    'insights',
    'posts',
    'updates',
  ],
  careers: [
    'careers',
    'career',
    'jobs',
    'join-us',
    'work-with-us',
    'vacancies',
  ],
} as const;
