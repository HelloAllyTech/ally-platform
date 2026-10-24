import { LlmTask } from 'src/learn/enum/llm-task.enum';
import { AI_TASK_REGISTRY } from 'src/llm/constants/ai-task-registry.constants';
import { TrackItemType } from 'src/track/type/track.type';
import { AnswerKeyEntry } from 'src/track/util/guide-notes-answer-leak.util';
import {
  AllyNotesInput,
  AllyNotesSpecialist,
  allyNotesOutlineForPrompt,
} from '../ally-notes.specialist';
import { SpecialistValidationError } from '../specialist.types';
import { fakeLlm } from './specialist-test.fixtures';

const TEMPLATE =
  'PROMPT\ntitle={{course_title}}\noutline={{course_outline}}\n' +
  'warnings={{trigger_warnings}}\ncurrent={{current_notes}}';

const KEYS: AnswerKeyEntry[] = [
  {
    itemId: 'quiz-1',
    itemTitle: 'Check',
    questionId: 'q1',
    prompt: 'What comes first on a call?',
    answer: 'Listen before you speak',
  },
];

const input = (overrides: Partial<AllyNotesInput> = {}): AllyNotesInput => ({
  trackId: 't1',
  title: 'Staying with a texter',
  description: 'For new volunteers.',
  sections: [
    {
      title: 'Opening',
      items: [
        {
          id: 'art-1',
          type: TrackItemType.ARTICLE,
          title: 'First messages',
          excerpt: '<p>The first message is often the hardest.</p>',
          defaultTension: 'low',
        },
        {
          id: 'rp-1',
          type: TrackItemType.ROLEPLAY,
          title: 'Meera goes quiet',
          defaultTension: 'high',
        },
        {
          id: 'quiz-1',
          type: TrackItemType.QUIZ,
          title: 'Check',
          defaultTension: 'medium',
        },
      ],
    },
  ],
  triggerWarnings: [{ itemTitle: 'Meera goes quiet', names: ['Self-harm'] }],
  currentNotes: null,
  answerKeys: KEYS,
  usageMetadata: { trackId: 't1', specialist: 'ally_notes' },
  ...overrides,
});

describe('AllyNotesSpecialist', () => {
  it('drafts notes and keeps only tension that differs from the default', async () => {
    const llm = fakeLlm(
      [
        {
          notes:
            'Learners here are new volunteers. Slow down after the roleplay.',
          tension: {
            'rp-1': 'high',
            'quiz-1': 'low',
            ghost: 'high',
            'art-1': 'extreme',
          },
        },
      ],
      TEMPLATE,
    );
    const draft = await new AllyNotesSpecialist(llm.service).generate(input());
    expect(draft).toEqual({
      notes: 'Learners here are new volunteers. Slow down after the roleplay.',
      tension: { 'quiz-1': 'low' },
    });
    const call = llm.complete.mock.calls[0][0];
    expect(call.task).toBe(LlmTask.COURSE_COPILOT_ALLY_NOTES);
    expect(call.taskId).toBe('course-copilot-ally-notes');
    expect(call.jsonMode).toBe(true);
    expect(llm.promptOf(0)).toContain('(id: rp-1) [');
    expect(llm.promptOf(0)).toContain('Meera goes quiet: Self-harm');
  });

  it('sends a draft that quotes a correct answer back once, without using it', async () => {
    const llm = fakeLlm(
      [
        { notes: 'Teach them to listen before you speak.', tension: {} },
        { notes: 'Teach them to slow down and stay curious.', tension: {} },
      ],
      TEMPLATE,
    );
    const draft = await new AllyNotesSpecialist(llm.service).generate(input());
    expect(draft.notes).toBe('Teach them to slow down and stay curious.');
    expect(llm.complete).toHaveBeenCalledTimes(2);
    expect(llm.promptOf(1)).toMatch(
      /repeat the answer to a question in "Check"/,
    );
  });

  it('gives up after the repair pass if the answer is still there', async () => {
    const leaky = { notes: 'Listen before you speak, always.', tension: {} };
    const llm = fakeLlm([leaky, leaky], TEMPLATE);
    await expect(
      new AllyNotesSpecialist(llm.service).generate(input()),
    ).rejects.toBeInstanceOf(SpecialistValidationError);
  });

  it('the outline never carries an answer key', () => {
    const outline = allyNotesOutlineForPrompt(input().sections);
    expect(outline).not.toContain('Listen before you speak');
    expect(outline).toContain('default tension high');
  });

  it('has an AI task registry row', () => {
    expect(
      AI_TASK_REGISTRY.find((row) => row.id === 'course-copilot-ally-notes'),
    ).toMatchObject({
      task: LlmTask.COURSE_COPILOT_ALLY_NOTES,
      promptOverride: 'course_copilot_ally_notes_writer',
    });
  });
});
