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
  /\.(png|jpe?g|gif|webp|svg|ico|css|js|mjs|json|xml|pdf|zip|gz|mp4|mp3|wav|webm|woff2?|ttf|eot|txt|csv|docx?|xlsx?|pptx?)$/i;

/** Pages never worth reading: sign-in, carts, archives, feeds and files. */
export function isJunk(url: string): boolean {
  const parsed = new URL(url);
  return (
    JUNK_PATH.test(parsed.pathname) ||
    ASSET.test(parsed.pathname) ||
    /[?&](replytocom|share|print)=/i.test(parsed.search)
  );
}
