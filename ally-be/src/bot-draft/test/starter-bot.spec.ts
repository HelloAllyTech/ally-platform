import { LearnedSection } from '../enum/bot-draft.enum';
import {
  STARTER_COPY,
  STARTER_MAX_QUESTIONS,
  starterOps,
} from '../service/starter-bot';

const empty = {
  assistantName: 'Sunrise Yoga',
  introduction: '',
  suggestedQuestions: [] as string[],
};
const fact = (section: LearnedSection) => ({ section });

describe('starterOps', () => {
  it('greets by the business name when there is no greeting', () => {
    const ops = starterOps(empty, []);
    expect(ops).toEqual([
      {
        op: 'replace',
        path: '/introduction',
        value: STARTER_COPY.greeting('Sunrise Yoga'),
      },
    ]);
    expect(STARTER_COPY.greeting('Sunrise Yoga')).toContain('Sunrise Yoga');
  });

  it('does not greet by a placeholder name', () => {
    for (const assistantName of ['Your business', 'Your assistant']) {
      expect(starterOps({ ...empty, assistantName }, [])).toEqual([]);
    }
  });

  it('reads naturally when the name already starts with "The"', () => {
    expect(STARTER_COPY.greeting('The Live Love Laugh Foundation')).toBe(
      "Hi, I'm the assistant for The Live Love Laugh Foundation. What would you like to know?",
    );
  });

  it('never replaces a greeting that is already there', () => {
    const ops = starterOps({ ...empty, introduction: 'Namaste!' }, []);
    expect(ops.find((op) => op.path === '/introduction')).toBeUndefined();
  });

  it('refreshes its own greeting when the business name improves', () => {
    const old = STARTER_COPY.greeting('Helloally');
    const ops = starterOps(
      { ...empty, assistantName: 'Ally for Mental Health', introduction: old },
      [],
    );
    expect(ops).toEqual([
      {
        op: 'replace',
        path: '/introduction',
        value: STARTER_COPY.greeting('Ally for Mental Health'),
      },
    ]);
  });

  it('leaves its own greeting alone when the name has not changed', () => {
    const same = STARTER_COPY.greeting('Sunrise Yoga');
    expect(starterOps({ ...empty, introduction: same }, [])).toEqual([]);
  });

  it('offers only questions for the kinds of detail it actually found', () => {
    const ops = starterOps(empty, [
      fact(LearnedSection.SERVICES),
      fact(LearnedSection.HOURS),
      fact(LearnedSection.SERVICES),
    ]);
    const questions = ops.find((op) => op.path === '/suggestedQuestions')
      ?.value as string[];
    expect(questions).toEqual([
      'What do you offer, and what does it cost?',
      'What are your opening hours?',
    ]);
  });

  it('offers no questions when nothing was found', () => {
    const ops = starterOps(empty, []);
    expect(ops.find((op) => op.path === '/suggestedQuestions')).toBeUndefined();
  });

  it('never replaces questions the owner or builder already wrote', () => {
    const ops = starterOps(
      { ...empty, suggestedQuestions: ['Do you do private lessons?'] },
      [fact(LearnedSection.ABOUT)],
    );
    expect(ops.find((op) => op.path === '/suggestedQuestions')).toBeUndefined();
  });

  it('caps the questions', () => {
    const ops = starterOps(
      empty,
      Object.values(LearnedSection).map((section) => fact(section)),
    );
    const questions = ops.find((op) => op.path === '/suggestedQuestions')
      ?.value as string[];
    expect(questions.length).toBeLessThanOrEqual(STARTER_MAX_QUESTIONS);
  });

  it('does nothing for a fully written draft', () => {
    expect(
      starterOps(
        {
          assistantName: 'X',
          introduction: 'Hello',
          suggestedQuestions: ['Q?'],
        },
        [fact(LearnedSection.ABOUT)],
      ),
    ).toEqual([]);
  });
});
