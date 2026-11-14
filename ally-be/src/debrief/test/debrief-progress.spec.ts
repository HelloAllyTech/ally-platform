import {
  assembleProgressProfile,
  progressCardDue,
  progressConsoleView,
  ProgressSettings,
  progressSkillKey,
  ProgressWindowRow,
} from '../util/debrief-progress.util';
import {
  defaultOwnerSettings,
  ownerSettingProblem,
  OWNER_SETTINGS_SPEC,
} from '../constants/debrief-owner-settings.constants';

const settings: ProgressSettings = {
  window: 6,
  cardEvery: 5,
  useFhs: true,
  showWorseToLearners: false,
};

const row = (
  i: number,
  over: Partial<ProgressWindowRow> = {},
): ProgressWindowRow => ({
  run_id: `run-${i}`,
  session_id: `s-${i}`,
  // Newest first: run-1 is the latest.
  created_at: new Date(Date.UTC(2026, 10, 20 - i)),
  scenario_title: `Scenario ${i}`,
  difficulty: 'HARD',
  risk: i === 2,
  analyst_version: 2,
  behaviours: [
    {
      skill: 'Empathy',
      opportunity: true,
      observation: 'observed',
      confidence: 'high',
      turn_index: 4,
    },
  ],
  cards: {
    work_on_this: [
      { skill: 'Empathy', lead: `Point ${i}`, turn_index: 4 },
      { skill: 'Open questions', lead: `Ask ${i}`, turn_index: 8 },
    ],
  },
  versions: [],
  pn_scenario_id: null,
  pn_scenario_title: null,
  pn_done: null,
  pn_published: null,
  ...over,
});

const assemble = (
  over: Partial<Parameters<typeof assembleProgressProfile>[0]> = {},
) =>
  assembleProgressProfile({
    settings,
    counselorId: 7,
    eligiblePast: 3,
    rows: [row(1), row(2), row(3)],
    flags: [],
    comments: [],
    lastReport: null,
    voice: [],
    fhs: [],
    ...over,
  });

describe('progressSkillKey', () => {
  it.each([
    ['Empathy', 'empathy'],
    ['empathy', 'empathy'],
    ['Empathy, warmth and genuineness', 'empathy'],
    ['Reflecting feelings', 'feelings'],
    ['Open-ended questions', 'verbal'],
    ['Active listening', 'verbal'],
    ['Asking about suicidal thoughts', 'harm'],
    ['Explaining confidentiality', 'confidentiality'],
    ['Collaborative goal-setting', 'goals'],
    ['Exploring risk and safety', 'harm'],
    ['Validation', 'feelings'],
    ['Exploring support systems', 'family'],
    ['Warmth and rapport', 'empathy'],
    ['Pacing', 'other'],
    ['Time management', 'other'],
    ['', 'other'],
  ])('%s → %s', (name, key) => {
    expect(progressSkillKey(name)).toBe(key);
  });
});

describe('progressCardDue', () => {
  it('is due every cardEvery-th session, and every session at 1', () => {
    expect(progressCardDue(5, 5)).toBe(true);
    expect(progressCardDue(10, 5)).toBe(true);
    expect(progressCardDue(6, 5)).toBe(false);
    expect(progressCardDue(1, 5)).toBe(false);
    expect(progressCardDue(1, 1)).toBe(true);
    expect(progressCardDue(7, 1)).toBe(true);
  });
});

describe('assembleProgressProfile', () => {
  it('counts every eligible past session plus this one, and marks the card due', () => {
    const p = assemble({ eligiblePast: 4 });
    expect(p.session_number).toBe(5);
    expect(p.card_due).toBe(true);
    expect(assemble({ eligiblePast: 5 }).card_due).toBe(false);
    expect(
      assemble({ eligiblePast: 5, settings: { ...settings, cardEvery: 1 } })
        .card_due,
    ).toBe(true);
    expect(p.settings).toEqual(settings);
  });

  it('caps the window at the setting, and never above 12', () => {
    const rows = Array.from({ length: 15 }, (_, i) => row(i + 1));
    expect(assemble({ rows }).sessions).toHaveLength(6);
    expect(
      assemble({ rows, settings: { ...settings, window: 40 } }).sessions,
    ).toHaveLength(12);
    // The eligible count is not the window: it counts all past debriefs.
    expect(assemble({ rows, eligiblePast: 15 }).session_number).toBe(16);
  });

  it('lists sessions newest first and observations oldest first', () => {
    const p = assemble();
    expect(p.sessions.map((s) => s.run_id)).toEqual([
      'run-1',
      'run-2',
      'run-3',
    ]);
    expect(p.sessions[0]).toMatchObject({
      session_id: 's-1',
      date: '2026-11-19',
      scenario: { title: 'Scenario 1', difficulty: 'hard', risk: false },
      analyst_version: 2,
      practise_next: null,
    });
    expect(p.sessions[1].scenario.risk).toBe(true);
    expect(p.skills.empathy.map((o) => o.run_id)).toEqual([
      'run-3',
      'run-2',
      'run-1',
    ]);
    expect(p.skills.empathy[0]).toEqual({
      run_id: 'run-3',
      date: '2026-11-17',
      opportunity: true,
      observation: 'observed',
      confidence: 'high',
      turn_index: 4,
      analyst_version: 2,
      corrected: false,
    });
  });

  it('marks an observation corrected when an advisor removed or corrected its point', () => {
    const p = assemble({
      flags: [
        {
          run_id: 'run-2',
          section: 'work_on_this[0]',
          status: 'removed',
          reason: 'didnt_say',
          user_id: 7,
        },
      ],
    });
    const byRun = Object.fromEntries(
      p.skills.empathy.map((o) => [o.run_id, o.corrected]),
    );
    expect(byRun).toEqual({ 'run-3': false, 'run-2': true, 'run-1': false });
    const point = p.past_points.find(
      (x) => x.run_id === 'run-2' && x.point === 'Point 2',
    );
    expect(point).toMatchObject({
      verdict: 'rejected',
      learner_flag: 'didnt_say',
    });
  });

  it('a correction in place, or a comment that a turn was read wrongly, also corrects', () => {
    const p = assemble({
      rows: [
        row(1, { versions: [{ section: 'work_on_this[0]', note: 'gentler' }] }),
        row(2),
        row(3),
      ],
      comments: [
        {
          run_id: 'run-3',
          anchor_kind: 'transcript',
          turn_index: 4,
          section: null,
          tag: 'wrong_or_unsupported',
        },
        {
          run_id: 'run-2',
          anchor_kind: 'card',
          turn_index: null,
          section: 'work_on_this[1].why',
          tag: 'good_keep_this',
        },
      ],
    });
    const byRun = Object.fromEntries(
      p.skills.empathy.map((o) => [o.run_id, o.corrected]),
    );
    expect(byRun).toEqual({ 'run-3': true, 'run-2': false, 'run-1': true });
    expect(p.past_points.find((x) => x.point === 'Point 1')?.verdict).toBe(
      'corrected',
    );
    expect(p.past_points.find((x) => x.point === 'Ask 2')?.verdict).toBe(
      'agreed',
    );
    expect(p.past_points.find((x) => x.point === 'Ask 3')?.verdict).toBeNull();
  });

  it('a kept flag agrees; a flag the team has not decided is only the learner’s', () => {
    const p = assemble({
      flags: [
        {
          run_id: 'run-1',
          section: 'work_on_this[0]',
          status: 'kept',
          reason: 'described_wrongly',
          user_id: 7,
        },
        {
          run_id: 'run-1',
          section: 'work_on_this[1]',
          status: 'open',
          reason: null,
          user_id: 7,
        },
      ],
    });
    expect(p.past_points.find((x) => x.point === 'Point 1')).toMatchObject({
      verdict: 'agreed',
      learner_flag: 'described_wrongly',
    });
    expect(p.past_points.find((x) => x.point === 'Ask 1')).toMatchObject({
      verdict: null,
      learner_flag: 'something_else',
    });
    expect(p.skills.empathy.every((o) => !o.corrected)).toBe(true);
  });

  it('sends a skill it cannot map as other, and skips malformed observations', () => {
    const p = assemble({
      rows: [
        row(1, {
          behaviours: [
            {
              skill: 'Time management',
              opportunity: false,
              observation: 'missed',
              confidence: 'odd',
              turn_index: null,
            },
            { skill: 'Empathy', observation: 'great' },
            { observation: 'observed' },
          ],
        }),
      ],
    });
    expect(Object.keys(p.skills)).toEqual(['other']);
    expect(p.skills.other[0]).toMatchObject({
      opportunity: false,
      confidence: 'low',
      turn_index: null,
    });
  });

  it('tracks Practise next uptake', () => {
    const p = assemble({
      rows: [
        row(1, {
          pn_scenario_id: 41,
          pn_scenario_title: 'Exam stress',
          pn_done: true,
          pn_published: true,
        }),
        row(2, { pn_scenario_id: '12', pn_scenario_title: 'Grief' }),
      ],
    });
    expect(p.sessions[0].practise_next).toEqual({
      scenario_title: 'Exam stress',
      done_after: true,
      outcome: 'published',
    });
    expect(p.sessions[1].practise_next).toEqual({
      scenario_title: 'Grief',
      done_after: false,
      outcome: null,
    });
  });

  it('keeps the learner’s six newest words, cut to 300 characters', () => {
    const voice = Array.from({ length: 8 }, (_, i) => ({
      session_id: 's-1',
      content: i === 0 ? 'x'.repeat(400) : `q${i}`,
      created_at: new Date(Date.UTC(2026, 10, 19, 10, 59 - i)),
      first_in_thread: i === 7,
      reflected: true,
    }));
    voice.push({
      session_id: 's-1',
      content: '   ',
      created_at: new Date(),
      first_in_thread: false,
      reflected: false,
    });
    const p = assemble({ voice });
    expect(p.learner_voice).toHaveLength(6);
    expect(p.learner_voice[0].text).toHaveLength(300);
    expect(p.learner_voice.every((v) => v.kind === 'ask_ally')).toBe(true);
    const r = assemble({ voice: voice.slice(7, 8) });
    expect(r.learner_voice[0].kind).toBe('reflection');
  });

  it('reads Foundational Skills levels oldest first, and none when switched off', () => {
    const fhs = [
      { at: '2026-11-15T00:00:00Z', session_id: 's-2', levels: { empathy: 3 } },
      {
        at: '2026-11-01T00:00:00Z',
        session_id: 's-9',
        levels: { empathy: 2, verbal: 9 },
      },
    ];
    expect(assemble({ fhs }).fhs).toEqual({
      empathy: [
        { date: '2026-11-01', session_id: 's-9', level: 2 },
        { date: '2026-11-15', session_id: 's-2', level: 3 },
      ],
    });
    expect(
      assemble({ fhs, settings: { ...settings, useFhs: false } }).fhs,
    ).toBeNull();
    expect(assemble({ fhs: [] }).fhs).toBeNull();
  });

  it('passes the last report through', () => {
    const last = {
      run_id: 'run-1',
      date: '2026-11-19',
      skills: [{ skill: 'empathy' }],
      focus: { skill: 'empathy' },
    };
    expect(assemble({ lastReport: last }).last_report).toEqual(last);
  });
});

describe('progress owner settings', () => {
  it('has the five progress settings with their defaults', () => {
    const keys = Object.entries(OWNER_SETTINGS_SPEC)
      .filter(([, s]) => s.group === 'progress')
      .map(([k]) => k);
    expect(keys).toEqual([
      'progressOn',
      'progressCardEvery',
      'progressWindow',
      'progressUseFhs',
      'progressShowWorseToLearners',
    ]);
    expect(defaultOwnerSettings()).toMatchObject({
      progressOn: true,
      progressCardEvery: 5,
      progressWindow: 6,
      progressUseFhs: true,
      progressShowWorseToLearners: false,
    });
  });

  it('refuses values outside their ranges', () => {
    expect(ownerSettingProblem('progressCardEvery', 1)).toBeNull();
    expect(ownerSettingProblem('progressCardEvery', 20)).toBeNull();
    expect(ownerSettingProblem('progressCardEvery', 0)).toMatch(/at least 1/);
    expect(ownerSettingProblem('progressCardEvery', 21)).toMatch(/at most 20/);
    expect(ownerSettingProblem('progressWindow', 2)).toMatch(/at least 3/);
    expect(ownerSettingProblem('progressWindow', 13)).toMatch(/at most 12/);
    expect(ownerSettingProblem('progressWindow', 4.5)).toMatch(/whole number/);
    expect(ownerSettingProblem('progressOn', 'yes')).toMatch(/true or false/);
    expect(ownerSettingProblem('progressShowWorseToLearners', true)).toBeNull();
  });
});

describe('progressConsoleView', () => {
  it('is null when no reading ran', () => {
    expect(progressConsoleView(undefined)).toBeNull();
  });

  it('maps a stored reading for the session view', () => {
    const view = progressConsoleView({
      shown_as: 'card',
      window_session_ids: ['a', 'b', 'c'],
      skills: [
        {
          skill: 'empathy',
          trend: 'worth_another_look',
          why: 'Missed twice lately.',
          evidence: [
            { run_id: 'this', turn_index: 5 },
            { run_id: 'run-2', turn_index: '7' },
          ],
          fhs: 'agrees',
          learner_line: '',
          hidden_from_learner: true,
        },
        { skill: 'verbal', trend: 'more_consistent', learner_line: 'Nice.' },
      ],
      followups: [{ point: 'Reflect feelings.', status: 'done' }],
      focus: {
        skill: 'empathy',
        why: 'x',
        learner_line: 'Try naming the feeling.',
        practise_next: true,
      },
      vetoes: [{ skill: 'harm', veto: 'too_few_sessions', detail: '2 < 3' }],
      created_at: '2026-11-13T10:00:00.000Z',
    });
    expect(view).toEqual({
      shownAs: 'card',
      sessions: 4,
      skills: [
        {
          skill: 'empathy',
          trend: 'worth_another_look',
          why: 'Missed twice lately.',
          evidence: [
            { run_id: 'this', turn_index: 5 },
            { run_id: 'run-2', turn_index: 7 },
          ],
          fhs: 'agrees',
          learnerLine: null,
          hiddenFromLearner: true,
        },
        {
          skill: 'verbal',
          trend: 'more_consistent',
          why: null,
          evidence: [],
          fhs: null,
          learnerLine: 'Nice.',
          hiddenFromLearner: false,
        },
      ],
      followups: [{ point: 'Reflect feelings.', status: 'done', evidence: [] }],
      focus: {
        skill: 'empathy',
        why: 'x',
        learnerLine: 'Try naming the feeling.',
        practiseNext: true,
      },
      vetoes: [{ skill: 'harm', veto: 'too_few_sessions', detail: '2 < 3' }],
      windowSessionIds: ['a', 'b', 'c'],
      createdAt: '2026-11-13T10:00:00.000Z',
    });
  });
});
