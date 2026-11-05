import {TranslationType} from '../type';

/**
 * Compile-time guards for `TranslationType`. `tsc` enforces these — the runtime
 * assertions below only exist so jest reports the file.
 *
 * The point of the plural widening is that it stays *narrow*: it must admit the base
 * key of a plural without collapsing into `string`, which would silently switch off
 * key checking across the whole app.
 */
const accepts = (key: TranslationType) => key;

describe('TranslationType', () => {
  it('accepts an ordinary key', () => {
    expect(accepts('profile.settings.language')).toBeTruthy();
  });

  it('accepts the base key of a plural, which is what i18next is called with', () => {
    expect(accepts('simulations.completedChip')).toBeTruthy();
    expect(accepts('common.minutes')).toBeTruthy();
  });

  it('still accepts an explicit plural form', () => {
    expect(accepts('simulations.completedChip_one')).toBeTruthy();
  });

  it('still rejects a key that is not in the catalogue', () => {
    // @ts-expect-error — not a key in en.json; if this stops erroring, the type has
    // widened to `string` and no longer checks anything.
    expect(() => accepts('simulations.notARealKey')).toBeDefined();
  });

  it('still rejects a bare namespace', () => {
    // @ts-expect-error — `simulations` is an object, not a leaf.
    expect(() => accepts('simulations')).toBeDefined();
  });
});
