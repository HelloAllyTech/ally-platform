/**
 * A full URL to a route inside this app, for links people copy and paste.
 *
 * The admin console is served under a base path in production
 * (`app.helloally.ai/admin/`), and `ROUTES` are relative to the router basename,
 * so `window.location.origin + ROUTES.X` drops the `/admin` and lands the
 * reader on the helpline app at the same origin. Derive the base from Vite's
 * `BASE_URL` — the same value the router basename comes from — so the two can
 * never disagree.
 */
export const absoluteAppUrl = (path: string): string => {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  return `${window.location.origin}${base}${path}`;
};
