import { BadRequestException } from '@nestjs/common';
import { DebriefFeedbackService } from '../service/debrief-feedback.service';
import { DebriefRunMode, DebriefRunStatus } from '../enum/debrief-run.enum';

/** PRD §6.7 "Correct in place" without a flag: quote locked, a new version, the learner's note. */
function build(status = DebriefRunStatus.BELOW_BAR) {
  const run: Record<string, any> = {
    id: 'run-1',
    scenarioSessionId: 's1',
    mode: DebriefRunMode.LIVE,
    status,
    cards: {
      work_on_this: [
        {
          lead: 'Pause before tips',
          quote: 'Maybe a timetable?',
          why: 'She hinted at hopelessness.',
          try_saying: 'What do you mean?',
          turn_index: 6,
        },
      ],
    },
    workspace: {},
  };
  const runs = {
    findOne: jest.fn(async () => ({
      ...run,
      cards: JSON.parse(JSON.stringify(run.cards)),
    })),
    update: jest.fn(async (_id, patch) => Object.assign(run, patch)),
  };
  const notifier = { reviewed: jest.fn() };
  const publisher = { applyToSession: jest.fn() };
  const svc = new DebriefFeedbackService(
    {} as any,
    runs as any,
    { find: jest.fn(async () => []) } as any,
    notifier as any,
    publisher as any,
  );
  return { svc, run, notifier, publisher };
}

describe('correct in place (no flag)', () => {
  it('saves version 2 with the note, keeps the quote, tells the learner', async () => {
    const { svc, run, notifier, publisher } = build();
    const res = await svc.correctRun(
      'run-1',
      'work_on_this[0]',
      { try_saying: 'You said what’s the point. Tell me more?' },
      'We made the suggested question gentler.',
      7,
    );
    expect(res).toEqual({
      id: 'run-1',
      version: 2,
      section: 'work_on_this[0]',
    });
    expect(run.cards.work_on_this[0].quote).toBe('Maybe a timetable?');
    expect(run.cards.work_on_this[0].try_saying).toMatch(/Tell me more/);
    expect(run.workspace.versions[0]).toMatchObject({
      version: 2,
      by: 7,
      section: 'work_on_this[0]',
      fields: ['try_saying'],
      note: 'We made the suggested question gentler.',
      flagId: null,
    });
    expect(run.workspace.versions[0].before.work_on_this[0].try_saying).toBe(
      'What do you mean?',
    );
    expect(publisher.applyToSession).toHaveBeenCalled();
    expect(notifier.reviewed).toHaveBeenCalled();
    expect(await svc.runCorrections('run-1')).toEqual([
      expect.objectContaining({
        section: 'work_on_this[0]',
        outcome: 'corrected',
        note: 'We made the suggested question gentler.',
      }),
    ]);
  });

  it('refuses a changed quote, a missing note, and a held debrief', async () => {
    const { svc } = build();
    await expect(
      svc.correctRun('run-1', 'work_on_this[0]', { quote: 'x' } as any, 'n', 7),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      svc.correctRun('run-1', 'work_on_this[0]', { why: 'x' }, '  ', 7),
    ).rejects.toBeInstanceOf(BadRequestException);
    const held = build(DebriefRunStatus.NEEDS_PERSON);
    await expect(
      held.svc.correctRun('run-1', 'work_on_this[0]', { why: 'x' }, 'n', 7),
    ).rejects.toThrow(/publish it before correcting/);
  });
});
