import {
  FOUNDATIONAL_FRAMEWORK,
  FOUNDATIONAL_FRAMEWORK_NAME,
  NO_FRAMEWORK,
  NO_FRAMEWORK_ID,
  SKILL_FRAMEWORK_KIND,
} from '../constants/debrief-framework.constants';
import {
  competencyKey,
  frameworkAttributes,
  frameworkFromChunk,
  parseSkillLine,
  skillKeyOf,
  skillNamesOf,
} from '../util/debrief-framework.util';
import { DebriefFrameworkService } from '../service/debrief-framework.service';
import { FHS_RUBRIC } from '../../foundational-skills/constants/helping-skills-rubric.constants';

describe('skill frameworks (spec DEBRIEF_ACROSS_ROLEPLAYS §4)', () => {
  describe('the built-in foundational framework', () => {
    it('has the 14 skills of the rubric, each with its rubric name, and the three chart areas', () => {
      const keys = FOUNDATIONAL_FRAMEWORK.skills.map((s) => s.key).sort();
      expect(keys).toEqual(FHS_RUBRIC.map((s) => s.key).sort());
      for (const s of FOUNDATIONAL_FRAMEWORK.skills) {
        expect(s.name).toBe(FHS_RUBRIC.find((r) => r.key === s.key)?.name);
        expect(s.words.length).toBeGreaterThan(0);
      }
      expect(FOUNDATIONAL_FRAMEWORK.foundational).toBe(true);
      expect(FOUNDATIONAL_FRAMEWORK.areas.map((a) => a.name)).toEqual([
        'Listening Engagement',
        'Emotional Attunement',
        'Supportive Engagement',
      ]);
    });

    it('matches narrow skills before the broad "verbal communication"', () => {
      const keys = FOUNDATIONAL_FRAMEWORK.skills.map((s) => s.key);
      expect(keys.indexOf('feelings')).toBeLessThan(keys.indexOf('verbal'));
      expect(keys[keys.length - 1]).toBe('verbal');
    });
  });

  describe('an entry in the Context Library', () => {
    it('round-trips a framework through its attributes', () => {
      const chunk = {
        code: 'DG-0210',
        statement: FOUNDATIONAL_FRAMEWORK_NAME,
        attributes: frameworkAttributes(FOUNDATIONAL_FRAMEWORK),
      };
      const back = frameworkFromChunk(chunk);
      expect(back).toMatchObject({
        id: 'DG-0210',
        name: FOUNDATIONAL_FRAMEWORK_NAME,
        foundational: true,
      });
      expect(back.skills).toEqual(FOUNDATIONAL_FRAMEWORK.skills);
      expect(back.areas).toEqual(FOUNDATIONAL_FRAMEWORK.areas);
    });

    it('reads skill lines: key | name | words, dropping lines without a key or name and duplicate keys', () => {
      expect(
        parseSkillLine('presence | Being present | Present, Stay with'),
      ).toEqual({
        key: 'presence',
        name: 'Being present',
        words: ['present', 'stay with'],
      });
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
  });

  describe('naming a skill the Analyst described loosely', () => {
    const custom = frameworkFromChunk({
      code: 'DG-2',
      statement: 'Palliative skills',
      attributes: {
        skills: [
          'presence | Being present | present, stay with',
          'honesty | Honest conversation | honest, truth',
        ],
      },
    });

    it('matches the framework’s own skill by key or exact name, then by an identifying word at a word start', () => {
      expect(skillKeyOf('Being present', custom)).toBe('presence');
      expect(skillKeyOf('HONESTY', custom)).toBe('honesty');
      expect(skillKeyOf('staying with silence', custom)).toBe('other');
      expect(skillKeyOf('Stay with the pain', custom)).toBe('presence');
      expect(skillKeyOf('Telling the truth gently', custom)).toBe('honesty');
      // A word only counts at the start of a word: "unpresent" is not "present".
      expect(skillKeyOf('unpresentable', custom)).toBe('other');
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

    it('trends nothing from a framework that lists no skills, except named competencies', () => {
      expect(skillKeyOf('Empathy', NO_FRAMEWORK)).toBe('other');
      expect(skillKeyOf('Empathy', NO_FRAMEWORK, ['Empathy'])).toBe(
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

describe('DebriefFrameworkService', () => {
  const chunk = (
    code: string,
    statement: string,
    skills: string[] = ['a | A | a'],
  ) => ({
    code,
    statement,
    facets: { kind: SKILL_FRAMEWORK_KIND },
    attributes: {
      skills,
      foundational: statement === FOUNDATIONAL_FRAMEWORK_NAME,
    },
  });

  function build(rows: unknown[] | Error) {
    const create = jest.fn(async (input: any) => ({
      code: 'DG-0999',
      statement: input.statement,
      facets: input.facets,
      attributes: input.attributes,
    }));
    const chunks = {
      find: jest.fn(async () => {
        if (rows instanceof Error) throw rows;
        return rows;
      }),
    };
    const dataSource = {
      transaction: jest.fn(async (fn: any) => fn({ query: jest.fn() })),
    };
    const svc = new DebriefFrameworkService(
      dataSource as any,
      chunks as any,
      { create } as any,
    );
    return { svc, create, chunks };
  }

  it('answers "none" without reading anything', async () => {
    const { svc, chunks } = build([]);
    expect(await svc.resolve(NO_FRAMEWORK_ID)).toBe(NO_FRAMEWORK);
    expect(chunks.find).not.toHaveBeenCalled();
  });

  it('answers a roleplay with no choice with the foundational entry, and one that chose a code with that entry', async () => {
    const rows = [
      chunk('DG-0100', FOUNDATIONAL_FRAMEWORK_NAME, [
        'verbal | Verbal communication | verbal',
      ]),
      chunk('DG-0300', 'Palliative skills', ['presence | Being present']),
    ];
    const { svc } = build(rows);
    expect((await svc.resolve(null)).id).toBe('DG-0100');
    expect((await svc.resolve('DG-0300')).name).toBe('Palliative skills');
  });

  it('falls back to the foundational entry when the chosen one is gone, and to the built-in copy when none can be read', async () => {
    const { svc } = build([chunk('DG-0100', FOUNDATIONAL_FRAMEWORK_NAME)]);
    expect((await svc.resolve('DG-9999')).id).toBe('DG-0100');
    const none = build([]);
    expect(await none.svc.resolve(null)).toBe(FOUNDATIONAL_FRAMEWORK);
    const broken = build(new Error('db down'));
    expect(await broken.svc.resolve('DG-0300')).toBe(FOUNDATIONAL_FRAMEWORK);
  });

  it('never turns the default off by an entry edited down to no skills', async () => {
    const { svc } = build([chunk('DG-0100', FOUNDATIONAL_FRAMEWORK_NAME, [])]);
    expect(await svc.resolve(null)).toBe(FOUNDATIONAL_FRAMEWORK);
  });

  it('seeds the foundational entry once, when it is missing, with the 14 skills', async () => {
    const { svc, create } = build([]);
    await svc.ensureSeed();
    expect(create).toHaveBeenCalledTimes(1);
    const input = create.mock.calls[0][0];
    expect(input.facets).toEqual({ kind: SKILL_FRAMEWORK_KIND });
    expect(input.statement).toBe(FOUNDATIONAL_FRAMEWORK_NAME);
    expect(input.attributes.skills).toHaveLength(14);
    expect(input.attributes.foundational).toBe(true);
    const have = build([chunk('DG-0100', FOUNDATIONAL_FRAMEWORK_NAME)]);
    await have.svc.ensureSeed();
    expect(have.create).not.toHaveBeenCalled();
  });

  it('lists the default first and "None" last, seeding the default if the library has none', async () => {
    const { svc, create } = build([]);
    const out = await svc.list();
    expect(create).toHaveBeenCalled();
    expect(out[out.length - 1]).toMatchObject({
      id: NO_FRAMEWORK_ID,
      name: 'None',
    });
    const rows = [
      chunk('DG-0300', 'Palliative skills'),
      chunk('DG-0100', FOUNDATIONAL_FRAMEWORK_NAME),
    ];
    const listed = await build(rows).svc.list();
    expect(listed.map((o) => o.id)).toEqual([
      'DG-0100',
      'DG-0300',
      NO_FRAMEWORK_ID,
    ]);
    expect(listed[0].isDefault).toBe(true);
  });
});
