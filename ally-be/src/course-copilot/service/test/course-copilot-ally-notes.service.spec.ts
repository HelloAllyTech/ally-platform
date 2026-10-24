import { BadGatewayException } from '@nestjs/common';
import { QuizQuestionType } from 'src/track/type/quiz.type';
import { TrackItemType } from 'src/track/type/track.type';
import {
  ALLY_NOTES_DRAFT_UNREADABLE_MESSAGE,
  CourseCopilotAllyNotesService,
} from '../course-copilot-ally-notes.service';
import { SpecialistValidationError } from '../specialists/specialist.types';

const track = {
  id: 't1',
  title: 'Course',
  description: '<p>About listening.</p>',
  guideNotes: { notes: 'Existing words.' },
  sections: [
    {
      title: 'One',
      items: [
        {
          id: 'art-1',
          type: TrackItemType.ARTICLE,
          title: 'Read',
          content: {
            html: '<p>Opening text.</p><div data-ally-question="aq"></div>',
          },
        },
        {
          id: 'quiz-1',
          type: TrackItemType.QUIZ,
          title: 'Check',
          content: {
            questions: [
              {
                id: 'q1',
                type: QuizQuestionType.MCQ_SINGLE,
                prompt: 'First?',
                options: [{ id: 'a', text: 'Listen before you speak' }],
                correctOptionIds: ['a'],
              },
            ],
          },
        },
      ],
    },
  ],
};

function setup(generate: jest.Mock) {
  const dataSource = {
    query: jest.fn(async () => [{ itemId: 'art-1', name: 'Grief' }]),
    getRepository: jest.fn(() => ({ find: jest.fn(async () => []) })),
  };
  const shared = { getTrackWithStructure: jest.fn(async () => track) };
  return new CourseCopilotAllyNotesService(
    dataSource as never,
    shared as never,
    { generate } as never,
  );
}

describe('CourseCopilotAllyNotesService', () => {
  it('drafts from the outline with the answer keys held back for the check', async () => {
    const generate = jest.fn(async () => ({
      notes: 'Go gently.',
      tension: {},
    }));
    const out = await setup(generate).draft('t1');
    expect(out).toEqual({
      draft: { notes: 'Go gently.', tension: {}, draftedByCopilot: true },
    });
    const input = (generate.mock.calls[0] as any)[0];
    expect(input.currentNotes).toBe('Existing words.');
    expect(input.answerKeys.map((k: any) => k.answer)).toEqual([
      'Listen before you speak',
    ]);
    expect(input.sections[0].items[0]).toMatchObject({
      excerpt: 'Opening text.',
      // A trigger warning raises an article to high.
      defaultTension: 'high',
    });
    expect(JSON.stringify(input.sections)).not.toContain(
      'Listen before you speak',
    );
  });

  it('turns an unusable draft into a readable 502', async () => {
    const generate = jest.fn(async () => {
      throw new SpecialistValidationError(['leak']);
    });
    const error = await setup(generate)
      .draft('t1')
      .catch((e) => e);
    expect(error).toBeInstanceOf(BadGatewayException);
    expect(error.message).toBe(ALLY_NOTES_DRAFT_UNREADABLE_MESSAGE);
  });
});
