import {
  cleanAssessorActivity,
  gradeAssessorActivity,
  overlapWithQuiz,
} from '../guide-assessor.service';
import { learnerSafeActivity } from '../../../runtime/guide-side-quest.service';

const option = (text: string, correct: boolean) => ({
  text,
  correct,
  feedback: `${text} leads somewhere`,
});

const raw = {
  title: 'Silence',
  intro: 'A quick check.',
  questions: [
    {
      prompt: 'What does the article suggest when a caller goes quiet?',
      sourceItemId: 'i1',
      options: [
        option('Wait', true),
        option('Fill it', false),
        option('Hang up', false),
      ],
    },
    {
      prompt: 'Two right answers here',
      sourceItemId: 'i1',
      options: [option('A', true), option('B', true), option('C', false)],
    },
    {
      prompt: 'From a locked item',
      sourceItemId: 'locked',
      options: [option('A', true), option('B', false), option('C', false)],
    },
  ],
};

describe('the Assessor', () => {
  it('keeps only well-formed questions on reached items, and the key server-side', () => {
    const activity = cleanAssessorActivity(
      'quick_check',
      raw,
      new Set(['i1']),
      [],
    );
    expect(activity?.questions.map((q) => q.prompt)).toEqual([
      'What does the article suggest when a caller goes quiet?',
    ]);
    const safe = JSON.stringify(
      learnerSafeActivity({ source: 'assessor', activity: activity! }),
    );
    expect(safe).not.toContain('correct');
    expect(safe).not.toContain('feedback');
    expect(safe).toContain('Fill it');
  });

  it('drops a question that rehearses a graded quiz question', () => {
    const quiz = [
      'What does the article suggest when a caller goes quiet on the line?',
    ];
    expect(
      overlapWithQuiz(raw.questions[0].prompt, quiz),
    ).toBeGreaterThanOrEqual(0.6);
    expect(
      cleanAssessorActivity('quick_check', raw, new Set(['i1']), quiz),
    ).toBeNull();
  });

  it('marks answers against the key without a model', () => {
    const activity = cleanAssessorActivity(
      'quick_check',
      raw,
      new Set(['i1']),
      [],
    )!;
    expect(
      gradeAssessorActivity(activity, [{ questionId: 'q1', optionId: 'b' }]),
    ).toEqual([
      {
        questionId: 'q1',
        correct: false,
        correctOptionId: 'a',
        feedback: 'Fill it leads somewhere',
      },
    ]);
  });
});
