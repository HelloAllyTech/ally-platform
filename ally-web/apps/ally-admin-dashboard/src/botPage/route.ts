/**
 * Which page this is (stage 7). Pure, so the rules are tested on their own.
 *
 * - `/chat/<id>`: the page's address, assigned by Ally.
 * - `/b/<slug>`: an old link. The page app loads it by its slug, then moves to `/chat/<id>`.
 * - anything else: a custom domain (the proxy serves the page for every path there), and the
 *   page is found by the hostname. There the API is on the same origin, so the visitor cookie
 *   stays first-party (ally-be docs/custom-domains.md).
 */
export interface PageRoute {
  key: string;
  kind: "address" | "legacy" | "domain";
}

export function pageRoute(pathname: string, base: string, hostname: string): PageRoute {
  const trimmed = base.replace(/\/$/, "");
  const path = trimmed && pathname.startsWith(trimmed) ? pathname.slice(trimmed.length) : pathname;
  const decode = (value: string) => {
    try {
      return decodeURIComponent(value);
    } catch {
      return "";
    }
  };
  const address = /^\/chat\/([^/?#]+)/.exec(path)?.[1];
  if (address) return { key: decode(address), kind: "address" };
  const legacy = /^\/b\/([^/?#]+)/.exec(path)?.[1];
  if (legacy) return { key: decode(legacy), kind: "legacy" };
  return { key: hostname.toLowerCase(), kind: "domain" };
}

/** Where an old `/b/<slug>` link goes: the same page on its address, keeping query and hash. */
export function addressUrl(base: string, publicId: string, search: string, hash: string): string {
  return `${base.replace(/\/$/, "")}/chat/${encodeURIComponent(publicId)}${search}${hash}`;
}
