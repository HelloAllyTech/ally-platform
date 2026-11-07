import { lookup as dnsLookup } from 'dns';
import { BlockList, isIP } from 'net';
import axios from 'axios';

/**
 * Fetching URLs that people give us, from inside our network, without letting them point at it.
 *
 * Loopback, private, link-local (cloud metadata), CGNAT and unspecified ranges are refused. The
 * address is checked in the request's own DNS `lookup`, so the address checked is the address
 * connected to (no gap for a DNS answer to change in between), and redirects are followed by hand
 * so every hop is checked again. Moved here from the track resource probe (chunk 20a) so the
 * onboarding crawl uses the same guard.
 */
const BLOCKED_ADDRESSES = new BlockList();
[
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
].forEach(([net, prefix]) =>
  BLOCKED_ADDRESSES.addSubnet(net as string, prefix as number, 'ipv4'),
);
BLOCKED_ADDRESSES.addAddress('::', 'ipv6');
BLOCKED_ADDRESSES.addAddress('::1', 'ipv6');
BLOCKED_ADDRESSES.addSubnet('fc00::', 7, 'ipv6');
BLOCKED_ADDRESSES.addSubnet('fe80::', 10, 'ipv6');

export function isBlockedAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return BLOCKED_ADDRESSES.check(mapped[1], 'ipv4');
  const family = isIP(address);
  if (family === 4) return BLOCKED_ADDRESSES.check(address, 'ipv4');
  if (family === 6) return BLOCKED_ADDRESSES.check(address, 'ipv6');
  return true;
}

/** A `lookup` that resolves normally but refuses any blocked address. */
export function guardedLookup(
  hostname: string,
  options: object,
  callback: (
    err: NodeJS.ErrnoException | null,
    address: string,
    family: number,
  ) => void,
) {
  dnsLookup(hostname, { ...options, all: false }, (err, address, family) => {
    if (err) return callback(err, '', 0);
    if (isBlockedAddress(address)) {
      return callback(
        new Error(`Refusing to fetch internal address for ${hostname}`),
        '',
        0,
      );
    }
    callback(null, address, family);
  });
}

/** Why a guarded fetch gave up. */
export type GuardedFetchFailure =
  | 'blocked_address'
  | 'bad_url'
  | 'too_many_redirects'
  | 'too_large'
  | 'not_html'
  | 'http_error'
  | 'network';

export class GuardedFetchError extends Error {
  constructor(
    readonly reason: GuardedFetchFailure,
    readonly status?: number,
  ) {
    super(reason);
  }
}

export interface GuardedFetchResult {
  url: string;
  status: number;
  contentType: string;
  body: string;
}

export interface GuardedFetchOptions {
  timeoutMs: number;
  maxBytes: number;
  maxRedirects?: number;
  userAgent: string;
  accept?: string;
  /** Content types accepted (prefix match); anything else is `not_html`. */
  contentTypes?: string[];
  /**
   * Hosts allowed even though they resolve to a blocked address. Development and tests only (a
   * local fixture server); callers must pass nothing in production.
   */
  allowHosts?: string[];
}

/**
 * GET a user-supplied URL as text, with the address guard, a byte cap, a timeout and every
 * redirect re-checked. Throws `GuardedFetchError`; never resolves for a blocked address.
 */
export async function guardedFetchText(
  url: string,
  options: GuardedFetchOptions,
): Promise<GuardedFetchResult> {
  let current = url;
  const maxRedirects = options.maxRedirects ?? 5;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    let parsed: URL;
    try {
      parsed = new URL(current);
    } catch {
      throw new GuardedFetchError('bad_url');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new GuardedFetchError('bad_url');
    }
    const host = parsed.hostname.replace(/^\[|\]$/g, '');
    const allowed = (options.allowHosts ?? []).includes(host);
    if (!allowed && isIP(host) && isBlockedAddress(host)) {
      throw new GuardedFetchError('blocked_address');
    }

    let response;
    try {
      response = await axios.get(current, {
        maxRedirects: 0,
        timeout: options.timeoutMs,
        responseType: 'arraybuffer',
        maxContentLength: options.maxBytes,
        maxBodyLength: options.maxBytes,
        validateStatus: () => true,
        ...(allowed ? {} : { lookup: guardedLookup as never }),
        headers: {
          'User-Agent': options.userAgent,
          Accept:
            options.accept ?? 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
        },
      });
    } catch (error) {
      const message = (error as Error).message ?? '';
      if (/internal address/.test(message))
        throw new GuardedFetchError('blocked_address');
      if (/maxContentLength|maxBodyLength/.test(message))
        throw new GuardedFetchError('too_large');
      throw new GuardedFetchError('network');
    }

    const location = response.headers['location'];
    if (response.status >= 300 && response.status < 400 && location) {
      current = new URL(String(location), current).toString();
      continue;
    }
    if (response.status < 200 || response.status >= 300) {
      throw new GuardedFetchError('http_error', response.status);
    }
    const contentType = String(
      response.headers['content-type'] ?? '',
    ).toLowerCase();
    if (
      options.contentTypes &&
      !options.contentTypes.some((type) => contentType.startsWith(type))
    ) {
      throw new GuardedFetchError('not_html');
    }
    const body = Buffer.from(response.data as ArrayBuffer).toString('utf8');
    return { url: current, status: response.status, contentType, body };
  }
  throw new GuardedFetchError('too_many_redirects');
}
