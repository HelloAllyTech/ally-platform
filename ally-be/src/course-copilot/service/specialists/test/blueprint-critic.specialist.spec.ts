import {
  compactBlueprintForCritic,
  dropCodeCheckedFindings,
} from '../blueprint-critic.specialist';

describe('dropCodeCheckedFindings', () => {
  const plan: any = {
    sections: [
      {
        items: [
          { id: 'a', type: 'ARTICLE', title: 'A', estimatedMinutes: 50 },
          { id: 'b', type: 'ROLEPLAY', title: 'B', estimatedMinutes: 59 },
        ],
      },
    ],
  };
  const lengthFinding: any = {
    severity: 'advisory',
    criterion: 'fit',
    problem:
      "The plan's total estimated duration (109 minutes) does not match the briefed course length of 120 minutes.",
    fix: 'Add 11 minutes.',
  };
  const other: any = {
    severity: 'blocking',
    criterion: 'reflection',
    itemId: 'b',
    problem: 'No debrief follows the roleplay.',
    fix: 'Add one.',
  };

  it('drops a length finding when the length check passed', () => {
    expect(
      dropCodeCheckedFindings([lengthFinding, other], plan, {
        shape: { durationMinutes: 120 },
      } as any),
    ).toEqual([other]);
  });

  it('keeps it when code also finds the length wrong', () => {
    expect(
      dropCodeCheckedFindings([lengthFinding, other], plan, {
        shape: { durationMinutes: 60 },
      } as any),
    ).toHaveLength(2);
  });
});

describe('compactBlueprintForCritic', () => {
  it("hides an annotated example's default pass mark, keeps a chosen one", () => {
    const compact = compactBlueprintForCritic({
      title: 'T',
      sections: [
        {
          id: 's',
          title: 'S',
          items: [
            {
              id: 'a',
              type: 'ANNOTATED_ARTIFACT',
              title: 'Labels',
              completionCriteria: { passScore: 70 },
            },
            {
              id: 'b',
              type: 'ANNOTATED_ARTIFACT',
              title: 'Labels 2',
              completionCriteria: { passScore: 85 },
            },
            {
              id: 'c',
              type: 'QUIZ',
              title: 'Quiz',
              completionCriteria: { passScore: 70 },
            },
          ],
        },
      ],
    } as any);
    const items = compact.sections[0].items as any[];
    expect(items[0].rule).toBeUndefined();
    expect(items[1].rule).toEqual({ passScore: 85 });
    expect(items[2].rule).toEqual({ passScore: 70 });
  });
});
