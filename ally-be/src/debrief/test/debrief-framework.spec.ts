import {
  SKILL_FRAMEWORK_KIND,
  emptyFramework,
} from '../constants/debrief-framework.constants';
import {
  competencyKey,
  frameworkFromChunk,
  mergeFrameworks,
  parseSkillLine,
  skillKeyOf,
  skillNamesOf,
} from '../util/debrief-framework.util';
import { DebriefFrameworkService } from '../service/debrief-framework.service';
import { assembleProgressProfile } from '../util/debrief-progress.util';

describe('skill frameworks (spec DEBRIEF_ACROSS_ROLEPLAYS §4)', () => {
  describe('an entry in the Context Library', () => {
    it('reads skill lines: key | name (a third column on an old entry is ignored), dropping lines without a key or name and duplicate keys', () => {
      expect(
        parseSkillLine('presence | Being present | Present, Stay with'),
      ).toEqual({ key: 'presence', name: 'Being present' });
      expect(parseSkillLine('presence')).toBeNull();
      expect(parseSkillLine('| Name')).toBeNull();
      const f = frameworkFromChunk({
        code: 'DG-1',
        statement: 'X',
        attributes: { skills: ['a | A', 'a | A again', 'b | B', '', 'c'] },
      });
      expect(f.skills.map((s) => s.key)).toEqual(['a', 'b']);
      expect(f.foundational).toBe(false);
      expect(f.areas).toEqual([]);
    });

    it('reads areas and the foundational flag from the attributes', () => {
      const f = frameworkFromChunk({
        code: 'DG-2',
        statement: ' Y ',
        attributes: {
          skills: ['a | A'],
          areas: ['Listening | listening well', 'Bare'],
          foundational: true,
        },
      });
      expect(f).toMatchObject({ id: 'DG-2', ids: ['DG-2'], name: 'Y' });
      expect(f.foundational).toBe(true);
      expect(f.areas).toEqual([
        { name: 'Listening', description: 'listening well' },
        { name: 'Bare', description: '' },
      ]);
    });
  });

  describe('merging every entry a run can read', () => {
    const a = frameworkFromChunk({
      code: 'DG-1',
      statement: 'One',
      attributes: { skills: ['x | X', 'y | Y'], areas: ['A1 | d'] },
    });
    const b = frameworkFromChunk({
      code: 'DG-2',
      statement: 'Two',
      attributes: {
        skills: ['y | Y again', 'z | Z'],
        areas: ['A1 | other', 'A2 | d2'],
        foundational: true,
      },
    });

    it('unions skills by key and areas by name, joins names, and is foundational if any entry is', () => {
      const m = mergeFrameworks([a, b]);
      expect(m.name).toBe('One + Two');
      expect(m.skills.map((s) => s.key)).toEqual(['x', 'y', 'z']);
      expect(m.skills[1].name).toBe('Y');
      expect(m.areas.map((x) => x.name)).toEqual(['A1', 'A2']);
      expect(m.foundational).toBe(true);
      expect(m.ids).toEqual(['DG-1', 'DG-2']);
      expect(m.id).toBeNull();
      expect(mergeFrameworks([a]).id).toBe('DG-1');
    });

    it('is the empty framework with no entries', () => {
      expect(mergeFrameworks([])).toEqual(emptyFramework());
    });
  });

  describe('naming a skill the Analyst wrote', () => {
    const custom = frameworkFromChunk({
      code: 'DG-2',
      statement: 'Palliative skills',
      attributes: {
        skills: ['presence | Being present', 'honesty | Honest conversation'],
      },
    });

    it('matches only the exact key or exact name: there is no keyword fallback', () => {
      expect(skillKeyOf('Being present', custom)).toBe('presence');
      expect(skillKeyOf('HONESTY', custom)).toBe('honesty');
      expect(skillKeyOf('honest_conversation', custom)).toBe('honesty');
      expect(skillKeyOf('staying with silence', custom)).toBe('other');
      expect(skillKeyOf('Stay with the pain', custom)).toBe('other');
      expect(skillKeyOf('Present', custom)).toBe('other');
      expect(skillKeyOf('Telling the truth gently', custom)).toBe('other');
    });

    it('trends a named competency of the roleplay under its own key, exact name only', () => {
      expect(skillKeyOf('Family meetings', custom, ['Family meetings'])).toBe(
        competencyKey('Family meetings'),
      );
      expect(competencyKey('Family  Meetings!')).toBe(
        'competency:family-meetings',
      );
      expect(skillKeyOf('Family meetings', custom, ['Something else'])).toBe(
        'other',
      );
    });

    it('trends nothing from the empty framework, except named competencies', () => {
      expect(skillKeyOf('Empathy', emptyFramework())).toBe('other');
      expect(skillKeyOf('Empathy', emptyFramework(), ['Empathy'])).toBe(
        'competency:empathy',
      );
    });

    it('lists every trendable skill by key: the framework’s, then the competencies’', () => {
      expect(skillNamesOf(custom, ['Family meetings'])).toEqual({
        presence: 'Being present',
        honesty: 'Honest conversation',
        'competency:family-meetings': 'Family meetings',
      });
    });
  });
});

describe('DebriefFrameworkService.forTenant', () => {
  const T1 = '11111111-1111-1111-1111-111111111111';
  const T2 = '22222222-2222-2222-2222-222222222222';
  const chunk = (
    code: string,
    statement: string,
    over: Record<string, unknown> = {},
  ) => ({
    code,
    statement,
    isGlobal: true,
    tenantIds: [] as string[],
    facets: { kind: SKILL_FRAMEWORK_KIND },
    attributes: { skills: [`${code.toLowerCase()} | ${statement}`] },
    ...over,
  });

  function build(rows: unknown[] | Error) {
    const find = jest.fn(async () => {
      if (rows instanceof Error) throw rows;
      return rows;
    });
    return { svc: new DebriefFrameworkService({ find } as any), find };
  }

  it('merges the global entries with the tenant’s own, never another tenant’s', async () => {
    const { svc } = build([
      chunk('DG-1', 'Global'),
      chunk('DG-2', 'Mine', { isGlobal: false, tenantIds: [T1] }),
      chunk('DG-3', 'Theirs', { isGlobal: false, tenantIds: [T2] }),
      chunk('DG-4', 'Not a framework', { facets: { kind: 'other' } }),
    ]);
    const f = await svc.forTenant(T1);
    expect(f.name).toBe('Global + Mine');
    expect(f.ids).toEqual(['DG-1', 'DG-2']);
    const other = await svc.forTenant(T2);
    expect(other.ids).toEqual(['DG-1', 'DG-3']);
    const none = await svc.forTenant(null);
    expect(none.ids).toEqual(['DG-1']);
  });

  it('reads only active Debrief Guidance entries', async () => {
    const { svc, find } = build([]);
    await svc.forTenant(T1);
    expect((find.mock.calls as any[][])[0][0].where).toEqual({
      collectionId: 'debrief_guidance',
      status: 'active',
    });
  });

  it('is the empty framework when the library is empty, and when it cannot be read; never throws', async () => {
    expect(await build([]).svc.forTenant(T1)).toEqual(emptyFramework());
    expect(await build(new Error('db down')).svc.forTenant(T1)).toEqual(
      emptyFramework(),
    );
  });

  it('has no skills once the only entry is deleted (retired or removed)', async () => {
    const before = await build([chunk('DG-1', 'Global')]).svc.forTenant(T1);
    expect(before.skills).toHaveLength(1);
    const after = await build([]).svc.forTenant(T1);
    expect(after.skills).toEqual([]);
  });
});

describe('the foundational flag gates the Foundational Skills levels', () => {
  const settings = {
    window: 8,
    cardEvery: 3,
    useFhs: true,
    showWorseToLearners: false,
  } as any;
  const base = {
    settings,
    counselorId: 7,
    eligiblePast: 0,
    rows: [] as any[],
    flags: [],
    comments: [],
    lastReport: null,
    voice: [],
    fhs: [
      { at: '2026-11-01', session_id: 's1', levels: { empathy: 3 } },
    ] as any[],
  };

  it('is data: the same levels are used or not, depending only on the framework', () => {
    const on = assembleProgressProfile({
      ...base,
      framework: { ...emptyFramework(), foundational: true },
    } as any);
    const off = assembleProgressProfile({
      ...base,
      framework: emptyFramework(),
    } as any);
    expect(on.fhs).toEqual({
      empathy: [{ date: expect.any(String), session_id: 's1', level: 3 }],
    });
    expect(off.fhs).toBeNull();
  });
});
