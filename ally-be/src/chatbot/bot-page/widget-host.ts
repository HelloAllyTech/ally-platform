import * as psl from 'psl';

/**
 * Where the website widget (chunk 13) may open: the owner's allowed domains, and the host a framed
 * page reports. Pure, so the rules are tested on their own.
 */

/** Hosts that only make sense on a developer's machine. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);
const HOSTNAME =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

export const MAX_WIDGET_DOMAINS = 10;

/**
 * Why a domain can't be added, as the dashboard words it.
 * - `invalid`: not a website address.
 * - `shared`: a public suffix or a shared hosting domain (github.io, wixsite.com): anyone can have a
 *   site under it, so it would let strangers' sites show the bubble. A site's own subdomain on it
 *   (myclinic.wixsite.com) is fine.
 * - `local`: localhost in production.
 */
type DomainRefusal = 'invalid' | 'shared' | 'local';

export type NormalisedDomain =
  | { domain: string }
  | { refused: DomainRefusal; input: string };

/**
 * "https://www.SunriseMind.in/contact" → "sunrisemind.in". Lower case; scheme, path, port and a
 * leading `www.` dropped; international names in their ASCII form.
 */
export function normaliseDomain(
  input: string,
  options: { production: boolean },
): NormalisedDomain {
  const raw = input.trim().toLowerCase();
  let host: string;
  try {
    host = new URL(/^[a-z][a-z0-9+.-]*:\/\//.test(raw) ? raw : `http://${raw}`)
      .hostname;
  } catch {
    return { refused: 'invalid', input };
  }
  host = host.replace(/\.$/, '').replace(/^www\./, '');
  if (LOCAL_HOSTS.has(host)) {
    return options.production ? { refused: 'local', input } : { domain: host };
  }
  if (IPV4.test(host) || !HOSTNAME.test(host))
    return { refused: 'invalid', input };
  if (isSharedSuffix(host)) return { refused: 'shared', input };
  return { domain: host };
}

/** A public suffix (co.in) or a shared hosting domain (github.io), per the Public Suffix List. */
function isSharedSuffix(host: string): boolean {
  const parsed = psl.parse(host);
  return 'error' in parsed && parsed.error
    ? true
    : (parsed as psl.ParsedDomain).domain === null;
}

/** The hostname of a host page's origin ("https://www.sunrisemind.in:8443" → "www.sunrisemind.in"). */
function hostOf(origin: string | null | undefined): string | null {
  if (!origin) return null;
  try {
    const url = new URL(origin);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return null;
  }
}

/**
 * Whether a host page's origin is one of the allowed domains, or a subdomain of one. A listed site
 * on a shared host (myclinic.wixsite.com) never matches its siblings (other.wixsite.com), and a
 * stored entry that is itself shared, or local in production, never matches anything.
 */
export function hostAllowed(
  allowed: readonly string[],
  origin: string | null | undefined,
  options: { production: boolean },
): boolean {
  const host = hostOf(origin);
  if (!host) return false;
  return allowed.some((entry) => {
    const checked = normaliseDomain(entry, options);
    if (!('domain' in checked)) return false;
    const domain = checked.domain;
    return host === domain || host.endsWith(`.${domain}`);
  });
}

/** The page URL the widget was on, without its query or fragment, if it is on the verified host. */
export function cleanPageUrl(
  page: string | null | undefined,
  hostOrigin: string,
): string | null {
  if (!page) return null;
  try {
    const url = new URL(page);
    if (url.origin !== new URL(hostOrigin).origin) return null;
    return `${url.origin}${url.pathname}`.slice(0, 500);
  } catch {
    return null;
  }
}

/** The `frame-ancestors` value for the embedded page: the allowed domains and their subdomains. */
export function frameAncestors(
  allowed: readonly string[],
  ownOrigin: string,
  options: { production: boolean },
): string {
  const sources = [`'self'`, ownOrigin];
  for (const entry of allowed) {
    const checked = normaliseDomain(entry, options);
    if (!('domain' in checked)) continue;
    if (LOCAL_HOSTS.has(checked.domain)) {
      sources.push(`http://${checked.domain}:*`);
      continue;
    }
    sources.push(`https://${checked.domain}`, `https://*.${checked.domain}`);
  }
  return `frame-ancestors ${[...new Set(sources)].join(' ')}`;
}
