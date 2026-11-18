import {
  applyPatch,
  PatchError,
  pathAllowed,
  pathsOverlap,
} from '../service/json-patch';

describe('json-patch (the subset onboarding uses)', () => {
  const doc = {
    name: 'Sunrise',
    topics: ['fees', 'hours'],
    branding: { title: 'Sunrise' },
  };

  it.each([
    [
      [{ op: 'replace', path: '/name', value: 'Sunrise Mind' }],
      { name: 'Sunrise Mind' },
    ],
    [
      [{ op: 'add', path: '/topics/-', value: 'team' }],
      { topics: ['fees', 'hours', 'team'] },
    ],
    [
      [{ op: 'add', path: '/topics/0', value: 'about' }],
      { topics: ['about', 'fees', 'hours'] },
    ],
    [[{ op: 'remove', path: '/topics/0' }], { topics: ['hours'] }],
    [
      [{ op: 'replace', path: '/branding/title', value: 'S' }],
      { branding: { title: 'S' } },
    ],
    [
      [{ op: 'add', path: '/branding/subtitle', value: 'Hi' }],
      { branding: { title: 'Sunrise', subtitle: 'Hi' } },
    ],
  ] as const)(
    'applies %j, and its inverse puts everything back',
    (ops, expected) => {
      const { result, inverse } = applyPatch(doc, ops as never);
      expect(result).toMatchObject(expected);
      expect(doc.topics).toEqual(['fees', 'hours']); // the input is never changed
      expect(applyPatch(result, inverse).result).toEqual(doc);
    },
  );

  it('undoes several ops in one patch, in reverse', () => {
    const ops = [
      { op: 'add', path: '/topics/-', value: 'a' },
      { op: 'add', path: '/topics/-', value: 'b' },
      { op: 'remove', path: '/topics/0' },
    ] as const;
    const { result, inverse } = applyPatch(doc, ops as never);
    expect(result.topics).toEqual(['hours', 'a', 'b']);
    expect(applyPatch(result, inverse).result).toEqual(doc);
  });

  it.each([
    [{ op: 'replace', path: '/missing', value: 1 }],
    [{ op: 'remove', path: '/topics/9' }],
    [{ op: 'add', path: '/topics/9', value: 'x' }],
    [{ op: 'replace', path: '/nope/deeper', value: 1 }],
    [{ op: 'add', path: 'name', value: 1 }],
  ])('refuses %j', (op) => {
    expect(() => applyPatch(doc, [op as never])).toThrow(PatchError);
  });

  it('matches allowed paths by prefix, not by string start', () => {
    expect(pathAllowed('/branding/title', ['/branding'])).toBe(true);
    expect(pathAllowed('/brandingx', ['/branding'])).toBe(false);
    expect(pathsOverlap('/branding', '/branding/title')).toBe(true);
    expect(pathsOverlap('/name', '/names')).toBe(false);
  });
});
