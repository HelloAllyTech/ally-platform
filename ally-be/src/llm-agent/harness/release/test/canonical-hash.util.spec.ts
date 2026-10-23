import { canonicalHash, canonicalJson } from '../canonical-hash.util';

describe('canonical hash', () => {
  it('ignores key order at every level', () => {
    expect(canonicalHash({ a: 1, b: { y: 2, x: [1, { q: 1, p: 2 }] } })).toBe(
      canonicalHash({ b: { x: [1, { p: 2, q: 1 }], y: 2 }, a: 1 }),
    );
  });

  it('keeps array order, which is meaningful', () => {
    expect(canonicalHash({ a: [1, 2] })).not.toBe(canonicalHash({ a: [2, 1] }));
  });

  it('drops undefined keys like JSON does', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });
});
