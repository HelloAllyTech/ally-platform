/**
 * Is this page being served on a directory owner's own domain (not the Ally app)? Then the whole
 * app is that collection's public page and nothing else.
 *
 * "Ally's own hosts" are localhost, anything under helloally.ai, and the comma-separated
 * `VITE_APP_HOSTS` (set it where the app is served from another name, e.g. a preview URL).
 * No imports from `@constants` on purpose: App.tsx runs this before anything else.
 */
export function isCustomDirectoryHost(hostname: string = window.location.hostname): boolean {
  const host = hostname.toLowerCase();
  if (!host || host === "localhost" || /^[\d.]+$/.test(host) || host.includes(":")) return false;
  if (host === "helloally.ai" || host.endsWith(".helloally.ai")) return false;
  const own = String(import.meta.env.VITE_APP_HOSTS ?? "")
    .split(",")
    .map(h => h.trim().toLowerCase())
    .filter(Boolean);
  return !own.includes(host);
}
