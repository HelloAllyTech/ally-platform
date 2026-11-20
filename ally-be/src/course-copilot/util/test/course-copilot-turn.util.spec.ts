import { courseCopilotQuestionProblems } from '../course-copilot-turn.util';

const option = (id: string) => ({ id, label: `Option ${id}` });
const ask = (input: Record<string, any>, message = '') => ({
  name: 'ask_trainer',
  input,
  message,
});
const keys = (problems: { key: string }[]) => problems.map((p) => p.key);

describe('courseCopilotQuestionProblems (Course Pilot: choice-only steps)', () => {
  it('passes a short choice with a short line above it', () => {
    expect(
      courseCopilotQuestionProblems(
        ask(
          {
            prompt: 'How long should the course be?',
            kind: 'singleSelect',
            options: [option('15'), option('20'), option('30')],
          },
          'Got it — volunteers on campus.',
        ),
      ),
    ).toEqual([]);
  });

  it('sends back an open question that could be a choice', () => {
    const problems = courseCopilotQuestionProblems(
      ask({ prompt: 'Who are the learners?', kind: 'freeText' }),
    );
    expect(keys(problems)).toEqual(['choice_only']);
    expect(problems[0].toModel).toContain('singleSelect');
  });

  it('treats a select with one option as an open question', () => {
    expect(
      keys(
        courseCopilotQuestionProblems(
          ask({
            prompt: 'Which audience?',
            kind: 'singleSelect',
            options: [option('a')],
          }),
        ),
      ),
    ).toEqual(['choice_only']);
  });

  it('allows free text for things only the trainer can type', () => {
    for (const prompt of [
      'Paste the YouTube link for the video',
      'What name should the course have?',
      'How many learners will take it?',
    ]) {
      expect(
        courseCopilotQuestionProblems(ask({ prompt, kind: 'freeText' })),
      ).toEqual([]);
    }
  });

  it('flags too many options, a long question and a long reply', () => {
    const problems = courseCopilotQuestionProblems(
      ask(
        {
          prompt: `Which of these ${'very '.repeat(40)}long options?`,
          kind: 'singleSelect',
          options: ['1', '2', '3', '4', '5', '6'].map(option),
        },
        'No brief fields are set yet; choosing a seed will set the terminal outcome and priorities. '.repeat(
          3,
        ),
      ),
    );
    expect(keys(problems)).toEqual([
      'too_many_options',
      'question_too_long',
      'reply_too_long',
    ]);
    expect(problems[2].toModel).toContain("don't describe what you looked up");
  });

  it('does not count the question itself as a reply above it', () => {
    const prompt = 'How long should the course be? '.repeat(5).trim();
    expect(
      keys(
        courseCopilotQuestionProblems(
          ask(
            {
              prompt,
              kind: 'singleSelect',
              options: [option('1'), option('2')],
            },
            prompt,
          ),
        ),
      ),
    ).not.toContain('reply_too_long');
  });

  it('checks only questions, not other endings', () => {
    expect(
      courseCopilotQuestionProblems({
        name: 'finish_turn',
        input: {},
        message: 'x'.repeat(500),
      }),
    ).toEqual([]);
  });
});

describe('describeCourseCopilotChanges: blueprint planning', () => {
  const {
    describeCourseCopilotChanges,
  } = require('../course-copilot-turn.util');

  it('appends what the planner had to the blueprint line', () => {
    expect(
      describeCourseCopilotChanges({
        before: { brief: {}, blueprintVersion: null },
        after: { brief: {}, blueprintVersion: 1 },
        coursePatches: [],
        queued: [],
        blueprintPlanning:
          'planned with example course "Supportive Listening" and design principles LD-0078',
      }),
    ).toEqual([
      'Blueprint drafted (v1) · planned with example course "Supportive Listening" and design principles LD-0078',
    ]);
  });
});
