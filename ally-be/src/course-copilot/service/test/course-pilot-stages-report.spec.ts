import {
  buildStagesReport,
  stageEvents,
} from '../course-pilot-stages-report.service';
import { briefHash } from '../../util/course-pilot-stages.util';
import {
  CourseCopilotJobStatus,
  CourseCopilotSessionStatus,
} from '../../enum/course-copilot.enum';

const fullBrief: any = {
  seed: 'Crisis calls for new volunteers',
  audience: { who: 'New helpline volunteers' },
  learnerProfileId: 'helpline-responders',
  outcomes: { terminal: 'Run a brief risk assessment on a call' },
  competencyIds: ['c1'],
  skillTargets: [{ skill: 'Risk', a: 'A2', b: 'B1' }],
  assessment: { kind: 'roleplay', threshold: 70 },
  shape: { durationMinutes: 60, languageIds: ['en'] },
};

const session = (over: any = {}): any => ({
  id: 's1',
  status: CourseCopilotSessionStatus.INTERVIEWING,
  brief: {},
  blueprint: null,
  metadata: { coursePilot: {} },
  ...over,
});

const byId = (report: any, id: string) =>
  report.stages.find((s: any) => s.id === id);

describe('Course Pilot stages report', () => {
  it('shows the interview waiting at the first open gate', () => {
    const report = buildStagesReport({
      session: session({ brief: { seed: 'Crisis calls' } }),
      messages: [],
      jobs: [],
      stagesSwitch: true,
    });
    expect(report.staged).toBe(true);
    expect(byId(report, 'intake').status).toBe('passed');
    const learners = byId(report, 'brief.learners');
    expect(learners.status).toBe('current');
    expect(learners.why).toMatch(/^Waiting for:/);
    expect(learners.checks[0].result).toBe('fail');
    expect(byId(report, 'blueprint').status).toBe('not_reached');
    expect(byId(report, 'build').status).toBe('not_reached');
    expect(byId(report, 'course').status).toBe('not_reached');
  });

  it('marks the final check passed once this exact brief is confirmed', () => {
    const confirmed = buildStagesReport({
      session: session({
        brief: fullBrief,
        metadata: { coursePilot: { confirmedBriefHash: briefHash(fullBrief) } },
      }),
      messages: [],
      jobs: [],
      stagesSwitch: true,
    });
    expect(byId(confirmed, 'brief.final').status).toBe('passed');

    const changed = buildStagesReport({
      session: session({
        brief: fullBrief,
        metadata: { coursePilot: { confirmedBriefHash: 'old' } },
      }),
      messages: [],
      jobs: [],
      stagesSwitch: true,
    });
    const final = byId(changed, 'brief.final');
    expect(final.status).toBe('current');
    expect(final.checks.map((c: any) => c.label)).toContain(
      'Brief changed after it was confirmed',
    );
  });

  it('names the sub-agents in each stage', () => {
    const at = new Date('2026-11-27T10:00:00Z');
    const report = buildStagesReport({
      session: session({
        status: CourseCopilotSessionStatus.EDITING,
        brief: fullBrief,
        blueprint: { title: 'x', sections: [] },
        metadata: {
          coursePilot: {
            confirmedBriefHash: briefHash(fullBrief),
            research: { intake: null },
            planner: {
              at: '2026-11-27T09:59:00Z',
              firstProblems: ['too long'],
              repairTried: true,
              repairKept: true,
            },
          },
        },
      }),
      messages: [],
      jobs: [
        {
          kind: 'quiz',
          status: CourseCopilotJobStatus.DONE,
          title: 'Q',
          error: null,
          summary: '6 questions',
          createdAt: at,
          finishedAt: at,
        },
        {
          kind: 'course_review',
          status: CourseCopilotJobStatus.DONE,
          title: null,
          error: null,
          summary: null,
          createdAt: at,
          finishedAt: at,
        },
      ],
      stagesSwitch: true,
    });
    const names = (id: string) =>
      byId(report, id).agents.map((a: any) => a.name);
    expect(names('intake')).toEqual(['Interviewer', 'Researcher']);
    expect(byId(report, 'intake').agents[1].detail).toBe(
      'Nothing relevant found',
    );
    expect(names('brief.final')).toEqual(['Interviewer']);
    expect(names('blueprint')).toEqual(['Planner', 'Critic']);
    expect(byId(report, 'blueprint').agents[0].detail).toContain('repair kept');
    expect(byId(report, 'blueprint').agents[1].state).toBe('off');
    expect(names('build')).toEqual([
      'Quiz writer',
      'Answer-key checker',
      'Reviewer',
    ]);
    // The final check ends when the planner ran.
    expect(byId(report, 'blueprint').enteredAt).toBe('2026-11-27T09:59:00Z');
  });

  it('reports build failures and answer-key disputes', () => {
    const at = new Date('2026-11-27T10:00:00Z');
    const report = buildStagesReport({
      session: session({ status: CourseCopilotSessionStatus.BUILD_FAILED }),
      messages: [],
      jobs: [
        {
          kind: 'quiz',
          status: CourseCopilotJobStatus.DONE,
          title: 'Check',
          error: null,
          summary: '6 questions · 2 questions removed: answer key disputed',
          createdAt: at,
          finishedAt: at,
        },
        {
          kind: 'article',
          status: CourseCopilotJobStatus.FAILED,
          title: 'Intro',
          error: 'timeout',
          summary: null,
          createdAt: at,
          finishedAt: at,
        },
      ],
      stagesSwitch: true,
    });
    const build = byId(report, 'build');
    expect(build.status).toBe('failed');
    expect(build.why).toContain('the build stopped');
    expect(build.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'Failed: Intro (article)',
          result: 'fail',
          detail: 'timeout',
        }),
        expect.objectContaining({
          label: 'Answer-key check: Check (quiz)',
          result: 'warn',
        }),
      ]),
    );
  });

  it('places each turn in its stage: a tagged card by its tag, the rest by when the turn ended', () => {
    const history = [
      { stage: 'brief.learners', at: '2026-11-27T10:00:30Z' },
      { stage: 'brief.outcomes', at: '2026-11-27T10:05:00Z' },
    ];
    const placed = stageEvents(
      [
        {
          // The turn started in intake and ended in learners (history written at its end).
          role: 'assistant',
          createdAt: new Date('2026-11-27T10:00:00Z'),
          metadata: {
            questions: [{ prompt: 'Who are the learners?' }],
            sentBack: ['brief_path_in_reply'],
            refused: [
              {
                tool: 'ask_trainer',
                error: 'question_limit',
                message: 'Limit reached',
              },
            ],
          },
        },
        {
          role: 'user',
          createdAt: new Date('2026-11-27T10:01:00Z'),
          metadata: null,
        },
        {
          role: 'assistant',
          createdAt: new Date('2026-11-27T10:06:00Z'),
          metadata: {
            questions: [{ prompt: 'Tagged', stage: 'brief.assessment' }],
          },
        },
      ],
      history,
      null,
    );
    expect(placed.get('brief.learners')!.map((e) => e.kind)).toEqual([
      'question',
      'sent_back',
      'refused',
    ]);
    expect(placed.get('brief.learners')![1].text).toMatch(
      /internal field name/,
    );
    expect(placed.get('brief.learners')![2].text).toBe(
      'ask_trainer refused (question_limit): Limit reached',
    );
    expect(placed.get('brief.assessment')!.map((e) => e.text)).toEqual([
      'Tagged',
    ]);
    expect(placed.get('intake')).toBeUndefined();
  });

  it("prefers the stage recorded on the turn's own row over times", () => {
    const placed = stageEvents(
      [
        {
          role: 'assistant',
          createdAt: new Date('2026-11-27T03:00:00Z'),
          metadata: {
            pilotStage: 'brief.outcomes',
            sentBack: ['reply_too_long'],
          },
        },
      ],
      [{ stage: 'brief.learners', at: '2026-11-27T10:00:30Z' }],
      null,
    );
    expect(placed.get('brief.outcomes')!.map((e) => e.text)).toEqual([
      'Reply was too long',
    ]);
  });
});
