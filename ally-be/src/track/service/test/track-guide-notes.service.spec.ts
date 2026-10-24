import {
  BadRequestException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ErrorCode } from 'src/exception/error-code.enum';
import { QuizQuestionType } from '../../type/quiz.type';
import { TrackItemType } from '../../type/track.type';
import { TrackGuideNotesService } from '../track-guide-notes.service';

const TRACK_ID = 'track-1';

function setup(guideNotes: unknown = null) {
  const track = {
    id: TRACK_ID,
    guideNotes,
    sections: [
      {
        id: 's1',
        title: 'Chapter one',
        items: [
          {
            id: 'quiz-1',
            title: 'Check',
            type: TrackItemType.QUIZ,
            content: {
              questions: [
                {
                  id: 'q1',
                  type: QuizQuestionType.MCQ_SINGLE,
                  prompt: 'What comes first?',
                  options: [
                    { id: 'a', text: 'Listen before you speak' },
                    { id: 'b', text: 'Advise quickly' },
                  ],
                  correctOptionIds: ['a'],
                },
              ],
            },
          },
          { id: 'rp-1', title: 'The call', type: TrackItemType.ROLEPLAY },
          { id: 'art-1', title: 'Reading', type: TrackItemType.ARTICLE },
        ],
      },
    ],
  };
  const trackService = {
    getTrackById: jest.fn(async () => track),
    assertCallerMayEdit: jest.fn(async () => undefined),
  };
  const trackRepository = {
    update: jest.fn(async (_id: string, patch: any) => {
      track.guideNotes = patch.guideNotes;
    }),
  };
  const dataSource = {
    query: jest.fn(async () => [{ itemId: 'art-1', name: 'Self-harm' }]),
  };
  const service = new TrackGuideNotesService(
    trackService as never,
    trackRepository as never,
    dataSource as never,
  );
  return { service, trackService, trackRepository, track };
}

describe('TrackGuideNotesService', () => {
  it('shows each item with its default tension and any override', async () => {
    const t = setup({
      notes: 'Go gently.',
      tension: { 'rp-1': 'medium', gone: 'high' },
      draftedByCopilot: true,
    });
    const view = await t.service.get(TRACK_ID);
    expect(view).toMatchObject({
      notes: 'Go gently.',
      draftedByCopilot: true,
    });
    expect(view.items.map((i) => [i.id, i.defaultTension, i.tension])).toEqual([
      ['quiz-1', 'medium', null],
      ['rp-1', 'high', 'medium'],
      // A trigger warning raises a reading to high.
      ['art-1', 'high', null],
    ]);
  });

  it('saves notes and tension after checking the caller may edit', async () => {
    const t = setup();
    const view = await t.service.save(TRACK_ID, {
      notes: '  Learners are new volunteers; slow down after the roleplay.  ',
      tension: { 'quiz-1': 'low' },
      draftedByCopilot: true,
    });
    expect(t.trackService.assertCallerMayEdit).toHaveBeenCalledWith(TRACK_ID);
    expect(t.trackRepository.update).toHaveBeenCalledWith(TRACK_ID, {
      guideNotes: {
        notes: 'Learners are new volunteers; slow down after the roleplay.',
        tension: { 'quiz-1': 'low' },
        draftedByCopilot: true,
      },
    });
    expect(view.items[0].tension).toBe('low');
  });

  it('refuses notes that contain a quiz answer, and saves nothing', async () => {
    const t = setup();
    const error = await t.service
      .save(TRACK_ID, { notes: 'Remind them to listen before you speak.' })
      .catch((e) => e);
    expect(error).toBeInstanceOf(UnprocessableEntityException);
    const body = error.getResponse();
    expect(body.errorCode).toBe(ErrorCode.GUIDE_NOTES_ANSWER_LEAK);
    expect(body.message).toContain('"Listen before you speak" (Check)');
    expect(body.message).toMatch(/Describe the idea without the answer/);
    expect(t.trackRepository.update).not.toHaveBeenCalled();
  });

  it('refuses an unknown item or tension level', async () => {
    const t = setup();
    await expect(
      t.service.save(TRACK_ID, { tension: { nope: 'low' } }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      t.service.save(TRACK_ID, { tension: { 'rp-1': 'extreme' } }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(t.trackRepository.update).not.toHaveBeenCalled();
  });

  it('empty notes and no tension clear the column', async () => {
    const t = setup({ notes: 'Old', tension: {} });
    await t.service.save(TRACK_ID, { notes: '   ' });
    expect(t.trackRepository.update).toHaveBeenCalledWith(TRACK_ID, {
      guideNotes: null,
    });
  });
});
