import {
  transferProblems,
  transferRequirements,
} from '../course-pilot-transfer.util';

const rp = (id: string, transfer?: string, targetSkills?: string[]) => ({
  id,
  type: 'ROLEPLAY',
  title: `Roleplay ${id}`,
  spec: {
    ...(transfer ? { transfer } : {}),
    ...(targetSkills ? { targetSkills } : {}),
  },
});
const plan = (...items: any[]) =>
  ({
    sections: [
      {
        id: 's1',
        title: 'Practice',
        items: [
          { id: 'a', type: 'ARTICLE', title: 'Read', spec: {} },
          ...items,
        ],
      },
    ],
  }) as any;
const brief = (...targets: any[]) => ({ skillTargets: targets }) as any;

describe('transferProblems', () => {
  it('asks nothing of B1 targets or briefs without targets', () => {
    expect(
      transferProblems(
        plan(rp('r1')),
        brief({ skill: 'Empathy', a: 'A2', b: 'B1' }),
      ),
    ).toEqual([]);
    expect(transferProblems(plan(rp('r1')), {} as any)).toEqual([]);
  });

  it('needs a new-similar practice for B2, after a practised one', () => {
    const b2 = brief({ skill: 'Risk', a: 'A2', b: 'B2' });
    expect(
      transferProblems(
        plan(rp('r1', 'practised'), rp('r2', 'new-similar')),
        b2,
      ),
    ).toEqual([]);
    const missing = transferProblems(
      plan(rp('r1', 'practised'), rp('r2', 'new-harder')),
      b2,
    );
    expect(missing[0]).toContain('"Risk" is B2');
    expect(missing[0]).toContain('A harder scenario does not count for B2');
  });

  it('needs a new-harder practice for B3', () => {
    const b3 = brief({ skill: 'Risk', a: 'A3', b: 'B3' });
    expect(
      transferProblems(plan(rp('r1', 'practised'), rp('r2', 'new-harder')), b3),
    ).toEqual([]);
    expect(
      transferProblems(
        plan(rp('r1', 'practised'), rp('r2', 'new-similar')),
        b3,
      ),
    ).toHaveLength(1);
  });

  it('refuses a transfer practice with nothing practised before it', () => {
    const problems = transferProblems(
      plan(rp('r1', 'new-similar')),
      brief({ skill: 'Risk', a: 'A2', b: 'B2' }),
    );
    expect(problems[0]).toContain('comes first');
  });

  it('checks each skill against the items that name it', () => {
    const targets = brief(
      { skill: 'Risk', b: 'B2' },
      { skill: 'Empathy', b: 'B2' },
    );
    const problems = transferProblems(
      plan(
        rp('r1', 'practised', ['Risk', 'Empathy']),
        rp('r2', 'new-similar', ['risk']),
      ),
      targets,
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('"Empathy" is B2');
  });

  it('accepts loose spellings of the transfer value', () => {
    const b2 = brief({ skill: 'Risk', b: 'B2' });
    expect(
      transferProblems(
        plan(rp('r1', 'practised'), rp('r2', 'New Similar')),
        b2,
      ),
    ).toEqual([]);
  });

  it('counts scenario quizzes as practice', () => {
    const quiz = {
      id: 'q',
      type: 'BRANCHING_SCENARIO',
      title: 'SJT',
      spec: { transfer: 'new-similar' },
    };
    expect(
      transferProblems(
        plan(rp('r1', 'practised'), quiz),
        brief({ skill: 'Risk', b: 'B2' }),
      ),
    ).toEqual([]);
  });
});

describe('transferRequirements', () => {
  it('tells the planner what each B2/B3 target needs', () => {
    const text = transferRequirements(
      brief(
        { skill: 'Risk', b: 'B2' },
        { skill: 'Empathy', b: 'B3' },
        { skill: 'X', b: 'B1' },
      ),
    )!;
    expect(text).toContain('"Risk" is B2');
    expect(text).toContain('"Empathy" is B3');
    expect(text).not.toContain('"X"');
  });
  it('is null when nothing needs transfer practice', () => {
    expect(transferRequirements(brief({ skill: 'X', b: 'B1' }))).toBeNull();
  });
});
