import { CourseBrief } from '../../type/course-copilot.type';
import {
  answerConfirmsBrief,
  briefHash,
  CHANGE_BRIEF_OPTION,
  CONFIRM_BRIEF_OPTION,
  COURSE_PILOT_MAX_QUESTIONS,
  questionRefusal,
  renderCoursePilotStage,
  resolveCoursePilotStage,
} from '../course-pilot-stages.util';

const learners: CourseBrief = {
  seed: 'Help helpline volunteers handle callers in crisis',
  audience: { who: 'New helpline volunteers' },
  learnerProfileId: 'p-volunteer-new',
};
const outcomes: CourseBrief = {
  ...learners,
  outcomes: { terminal: 'Stay with a caller in crisis and assess risk' },
  competencyIds: ['c1'],
  skillTargets: [{ skill: 'Risk assessment', a: 'A2', b: 'B2' }],
};
const assessment: CourseBrief = {
  ...outcomes,
  assessment: { kind: 'roleplay' },
};
const complete: CourseBrief = {
  ...assessment,
  shape: { durationMinutes: 60, languageIds: ['1'] },
};

describe('Course Pilot stages', () => {
  it('starts at intake with an empty brief', () => {
    const position = resolveCoursePilotStage({}, {});
    expect(position.stage.id).toBe('intake');
    expect(position.step).toBe(1);
    expect(position.missing).toEqual(['what the course is for (/seed)']);
  });

  it('is in the first stage whose gate is closed', () => {
    expect(resolveCoursePilotStage({ seed: 'x' }, {}).stage.id).toBe(
      'brief.learners',
    );
    expect(resolveCoursePilotStage(learners, {}).stage.id).toBe(
      'brief.outcomes',
    );
    expect(resolveCoursePilotStage(outcomes, {}).stage.id).toBe(
      'brief.assessment',
    );
    expect(resolveCoursePilotStage(assessment, {}).stage.id).toBe(
      'brief.constraints',
    );
    expect(resolveCoursePilotStage(complete, {}).stage.id).toBe('brief.final');
  });

  it('skips stages a first message already answers', () => {
    // A trainer who says everything up front lands straight on the final check.
    expect(resolveCoursePilotStage(complete, {}).step).toBe(6);
  });

  it('goes back when an earlier answer is removed', () => {
    const noProfile: CourseBrief = { ...complete, learnerProfileId: undefined };
    const position = resolveCoursePilotStage(noProfile, {});
    expect(position.stage.id).toBe('brief.learners');
    expect(position.missing).toEqual([
      'the closest learner profile (/learnerProfileId)',
    ]);
  });

  it('needs 1-3 skill targets, each with A and B', () => {
    const none = { ...outcomes, skillTargets: [] };
    expect(resolveCoursePilotStage(none, {}).missing).toContain(
      '1-3 skill targets (/skillTargets)',
    );
    const four = {
      ...outcomes,
      skillTargets: [1, 2, 3, 4].map((n) => ({
        skill: `s${n}`,
        a: 'A1' as const,
        b: 'B1' as const,
      })),
    };
    expect(resolveCoursePilotStage(four, {}).stage.id).toBe('brief.outcomes');
    expect(resolveCoursePilotStage(four, {}).missing[0]).toContain(
      'there are 4',
    );
    const noB = {
      ...outcomes,
      skillTargets: [{ skill: 'Risk', a: 'A2' as const }],
    };
    expect(resolveCoursePilotStage(noB, {}).missing).toEqual([
      'level A and transfer B on every skill target',
    ]);
  });

  it('opens the plan stage only for the brief the trainer confirmed', () => {
    const confirmed = { confirmedBriefHash: briefHash(complete) };
    expect(resolveCoursePilotStage(complete, confirmed).stage.id).toBe(
      'blueprint',
    );
    const changed = {
      ...complete,
      shape: { durationMinutes: 90, languageIds: ['1'] },
    };
    expect(resolveCoursePilotStage(changed, confirmed).stage.id).toBe(
      'brief.final',
    );
  });

  it('ignores what the confirm card does not show', () => {
    expect(briefHash({ ...complete, notes: ['a note'] })).toBe(
      briefHash(complete),
    );
    expect(
      briefHash({
        ...complete,
        practice: [{ slot: 'p1', source: 'new' } as any],
        look: { cover: 'generate' },
        outcomes: { ...complete.outcomes, enabling: ['Ask directly'] },
        shape: { ...complete.shape, practiceWeight: 'practice-heavy' },
      }),
    ).toBe(briefHash(complete));
  });

  it('changes when something on the card changes', () => {
    expect(briefHash({ ...complete, assessment: { kind: 'quiz' } })).not.toBe(
      briefHash(complete),
    );
    expect(
      briefHash({
        ...complete,
        shape: { ...complete.shape, durationMinutes: 90 },
      }),
    ).not.toBe(briefHash(complete));
  });

  it('hashes the same brief the same whatever the key order', () => {
    const reordered: CourseBrief = {
      shape: { languageIds: ['1'], durationMinutes: 60 },
      ...assessment,
    };
    expect(briefHash(reordered)).toBe(briefHash(complete));
  });

  describe('question limits', () => {
    it('allows questions until the stage limit', () => {
      const position = resolveCoursePilotStage(learners, {
        questions: { 'brief.outcomes': 4 },
      });
      expect(position.questionsLeft).toBe(1);
      expect(questionRefusal(position)).toBeNull();
    });

    it('refuses past the stage limit and says to fill defaults', () => {
      const position = resolveCoursePilotStage(learners, {
        questions: { 'brief.outcomes': 5 },
      });
      const refusal = questionRefusal(position);
      expect(refusal).toContain(
        '5-question limit for "Outcomes and skill targets"',
      );
      expect(refusal).toContain('must not ask the trainer anything');
      expect(refusal).toContain('update_brief');
    });

    it('refuses past the whole-interview limit even with stage questions left', () => {
      const position = resolveCoursePilotStage(learners, {
        questions: {
          intake: 2,
          'brief.learners': 3,
          'brief.assessment': 3,
          'brief.constraints': 3,
          'brief.final': 1,
        },
      });
      expect(position.totalAsked).toBe(COURSE_PILOT_MAX_QUESTIONS);
      expect(questionRefusal(position)).toContain(
        `${COURSE_PILOT_MAX_QUESTIONS}-question limit`,
      );
    });
  });

  describe('confirming the brief', () => {
    const pending = {
      pendingConfirm: { questionId: 'q1', briefHash: briefHash(complete) },
    };

    it('confirms when the trainer picks confirm on that card for that brief', () => {
      expect(
        answerConfirmsBrief(
          pending,
          { questionId: 'q1', selectedOptionIds: [CONFIRM_BRIEF_OPTION] },
          complete,
        ),
      ).toBe(true);
    });

    it('does not confirm on "change something"', () => {
      expect(
        answerConfirmsBrief(
          pending,
          { questionId: 'q1', selectedOptionIds: [CHANGE_BRIEF_OPTION] },
          complete,
        ),
      ).toBe(false);
    });

    it('does not confirm an answer to another question', () => {
      expect(
        answerConfirmsBrief(
          pending,
          { questionId: 'q2', selectedOptionIds: [CONFIRM_BRIEF_OPTION] },
          complete,
        ),
      ).toBe(false);
    });

    it('does not confirm when the brief changed after the card was shown', () => {
      const changed = { ...complete, assessment: { kind: 'quiz' as const } };
      expect(
        answerConfirmsBrief(
          pending,
          { questionId: 'q1', selectedOptionIds: [CONFIRM_BRIEF_OPTION] },
          changed,
        ),
      ).toBe(false);
    });

    it('does not confirm with no card waiting', () => {
      expect(
        answerConfirmsBrief(
          {},
          { questionId: 'q1', selectedOptionIds: [CONFIRM_BRIEF_OPTION] },
          complete,
        ),
      ).toBe(false);
    });
  });

  it('only the plan stage has propose_blueprint', () => {
    for (const brief of [{}, learners, outcomes, assessment, complete]) {
      expect(resolveCoursePilotStage(brief, {}).stage.tools).not.toContain(
        'propose_blueprint',
      );
    }
    expect(
      resolveCoursePilotStage(complete, {
        confirmedBriefHash: briefHash(complete),
      }).stage.tools,
    ).toContain('propose_blueprint');
  });

  it('renders the stage block with what is still needed', () => {
    const text = renderCoursePilotStage(resolveCoursePilotStage(learners, {}));
    expect(text).toContain(
      'id="brief.outcomes" step="3 of 7" questions_left="5"',
    );
    expect(text).toContain(
      'Still needed before the next stage: the main outcome',
    );
  });
});

import { claimsBuildStarted } from '../course-copilot-turn.util';

describe('claimsBuildStarted', () => {
  it.each([
    'Building the course draft now from the approved blueprint.',
    "I've started the build.",
    'The build has started.',
    "I'll build the course now.",
    'Creating your course draft now.',
  ])('catches "%s"', (text) => expect(claimsBuildStarted(text)).toBe(true));

  it.each([
    'Click Approve and the build will start.',
    'Once you approve, I will build the course.',
    'Building blocks: empathy and risk questions.',
    "The build hasn't started yet.",
    'Before the build starts, check the plan.',
  ])('leaves "%s" alone', (text) =>
    expect(claimsBuildStarted(text)).toBe(false),
  );
});

import { renderBriefSummary } from '../course-pilot-stages.util';

describe('final check never runs out of questions', () => {
  it('always allows the confirm card, whatever was asked before', () => {
    const position = resolveCoursePilotStage(complete, {
      questions: { 'brief.final': 5, 'brief.outcomes': 5, 'brief.learners': 3 },
    });
    expect(position.stage.id).toBe('brief.final');
    expect(questionRefusal(position)).toBeNull();
  });
});

describe('renderBriefSummary', () => {
  it('shows a fractional pass mark as a percent', () => {
    const text = renderBriefSummary({
      ...complete,
      assessment: { kind: 'roleplay', threshold: 0.7 },
    });
    expect(text).toContain('Assessment: roleplay, pass 70%');
  });
  it('keeps a percent pass mark', () => {
    const text = renderBriefSummary({
      ...complete,
      assessment: { kind: 'quiz', threshold: 80 },
    });
    expect(text).toContain('Assessment: quiz, pass 80%');
  });
});
