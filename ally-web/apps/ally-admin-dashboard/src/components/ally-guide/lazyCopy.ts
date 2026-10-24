/**
 * A module-level handle on a block of copy that is read only when a property is used.
 *
 * The copy barrel (`@constants`) does module-load-time work and reaches back into `@components`, so
 * reading `en.…` while a module loads can hit a half-initialised cycle (ally-web/CLAUDE.md, "No
 * module-load-time work in shared modules"). Components read through this instead of a top-level
 * `const strings = en.…`, which keeps the short `strings.x` form without touching `en` at import.
 */
export const lazyCopy = <T extends object>(read: () => T): T =>
  new Proxy({} as T, { get: (_target, key) => (read() as Record<PropertyKey, unknown>)[key] });
