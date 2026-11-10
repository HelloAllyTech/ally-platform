import * as fs from 'fs';
import * as path from 'path';

/**
 * `migration:run` loads every file matching the migrations glob and calls `new` on every function
 * it exports. An exported helper arrow function is not a constructor, so one of them makes the
 * whole run throw "someClass is not a constructor" before any migration executes — and it only
 * surfaces in the production deploy, after the new containers are already up.
 *
 * It has happened twice (the PARENT_COURSE seed on 2026-11-05, and the Context Library passage
 * copy in be-v1.180.0, which took the API down). Helpers belong outside `migrations/`, in
 * `../migration-helpers/` or `../seed-data/`.
 */
describe('migration exports', () => {
  const dir = __dirname;
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^[0-9].*\.ts$/.test(f) && !f.endsWith('.spec.ts'));

  it('finds the migrations', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it.each(files)('%s exports no function that is not a class', (file) => {
    const mod = require(path.join(dir, file)) as Record<string, unknown>;
    const notConstructable = Object.entries(mod)
      .filter(([, value]) => typeof value === 'function')
      .filter(([, value]) => !(value as { prototype?: unknown }).prototype)
      .map(([name]) => name);
    expect(notConstructable).toEqual([]);
  });
});
