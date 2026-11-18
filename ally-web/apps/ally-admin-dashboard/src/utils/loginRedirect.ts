/**
 * Back to where they were after logging in (A1). Someone not logged in who opens any page (an
 * assistant deep link like `/assistants/:id?section=lists`, Try it, the list) lands on the login
 * screen with `?next=<that path>`, and logging in takes them back there.
 *
 * No imports from `@constants` on purpose: these run inside guards and the API layer, and the
 * admin's test suites mock `@constants` wholesale.
 */
export const LOGIN_PATH = "/login";
export const NEXT_PARAM = "next";

/** The login path, carrying `next` unless they were at the root or on login itself. */
export function loginPathWithNext(pathname: string, search = "", hash = ""): string {
  const here = `${pathname}${search}${hash}`;
  if (!pathname || pathname === "/" || pathname.startsWith(LOGIN_PATH)) return LOGIN_PATH;
  return `${LOGIN_PATH}?${NEXT_PARAM}=${encodeURIComponent(here)}`;
}

/**
 * A `next` that is safe to go to: a path inside this app. Anything else (another site,
 * protocol-relative `//evil.com`, a backslash trick, login itself) is ignored, and they land on
 * their first page as before.
 */
export function safeNext(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return null;
  // eslint-disable-next-line no-control-regex -- control characters are exactly what is refused
  if (/[\u0000-\u001f]/.test(raw)) return null;
  if (raw === LOGIN_PATH || raw.startsWith(`${LOGIN_PATH}?`) || raw.startsWith(`${LOGIN_PATH}/`)) {
    return null;
  }
  return raw;
}

/**
 * Where to go after logging in, from the login page's own query string. `shownAt` is the page the
 * login screen is drawn on when it stands in for it (a signed-out visitor to `/assistants` sees
 * the login screen at that same URL): with no `next`, they stay there.
 */
export function afterLoginPath(search: string, shownAt?: string): string {
  const next = safeNext(new URLSearchParams(search).get(NEXT_PARAM));
  if (next) return next;
  return safeNext(shownAt) ?? "/";
}
