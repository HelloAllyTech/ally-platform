import { SCENARIO_SESSION_DEBRIEF_READY_EVENT } from '../../learn/constants/scenario-session-events.constants';
import { DebriefRunMode, DebriefRunStatus } from '../enum/debrief-run.enum';
import { DebriefPublishService } from '../service/debrief-publish.service';
import { DebriefCards } from '../util/debrief-cards.util';
import {
  hasLegacyFeedback,
  isDebriefAgentLiveForSession,
} from '../util/debrief-live.util';
import {
  areasOfGrowthFromCards,
  claimsFromCards,
  emotionalMovementFromEvidence,
  memoryUpdateFromCards,
  renderSupervisorNote,
  skillCoverageFromEvidence,
} from '../util/debrief-publish.util';

const cards: DebriefCards = {
  opening: 'You stayed with Meena when she went quiet.',
  important_moment: {
    turn_index: 2,
    quote: "I don't see the point.",
    handled_well: false,
    lead: 'She told you she saw no point.',
    body: 'Ask about safety directly next time.',
  },
  what_worked: [
    {
      skill: 'Reflections',
      turn_index: 3,
      quote: 'That sounds heavy.',
      lead: 'You named how heavy it felt.',
      body: 'It helped her keep talking.',
    },
  ],
  work_on_this: [
    {
      skill: 'Exploring risk',
      turn_index: 5,
      quote: 'What do you mean?',
      lead: 'Ask about suicide plainly.',
      why: 'It is how you learn whether she is safe.',
      try_saying: 'Are you thinking about ending your life?',
    },
  ],
  practise_next: { skill: 'Exploring risk', reason: 'Asking directly.' },
  skill_words: [],
  reflective_question: 'What stopped you asking directly?',
  progress_note: null,
} as unknown as DebriefCards;

describe('publish write-out (v9 FR-20, FR-42)', () => {
  it('computes skill coverage per area from the evidence map, partial counting half', () => {
    const evidence = {
      behaviours: [
        {
          coverage_category: 'Listening Engagement',
          opportunity: true,
          observation: 'observed',
        },
        {
          coverage_category: 'Listening Engagement',
          opportunity: true,
          observation: 'partial',
        },
        {
          coverage_category: 'Emotional Attunement',
          opportunity: true,
          observation: 'missed',
        },
        // No chance at it: not counted.
        {
          coverage_category: 'Emotional Attunement',
          opportunity: false,
          observation: 'missed',
        },
        // Untagged: not counted.
        { opportunity: true, observation: 'observed' },
      ],
    };
    expect(skillCoverageFromEvidence(evidence)).toEqual([
      { category: 'Listening Engagement', percentage: 75 },
      { category: 'Emotional Attunement', percentage: 0 },
    ]);
    expect(skillCoverageFromEvidence({})).toEqual([]);
  });

  it('renders the cards as today’s note: machine keys, message anchors, no turn numbers', () => {
    const messageFor = (turn: number) => 100 + turn;
    const note = renderSupervisorNote(cards, messageFor);
    // The opening comes first, unlabelled.
    expect(note.startsWith('You stayed with Meena')).toBe(true);
    // A missed important moment belongs under what it cost.
    expect(note).toMatch(
      /## \[what_it_cost\]\nShe told you she saw no point\. “I don't see the point\.” \[\[msg:102\]\]/,
    );
    expect(note).toContain(
      '## [what_worked]\n- You named how heavy it felt. “That sounds heavy.” [[msg:103]]',
    );
    expect(note).toContain(
      '## [try_next]\n- “Are you thinking about ending your life?”',
    );
    expect(note).toContain('## [closing]\nWhat stopped you asking directly?');
    expect(note).not.toMatch(/turn \d/);
    // Without a message map there are no anchors, and nothing breaks.
    expect(renderSupervisorNote(cards)).not.toContain('[[msg:');
  });

  it('writes growth areas, emotional movement on messages, and nothing for unknown turns', () => {
    expect(areasOfGrowthFromCards(cards)).toEqual([
      {
        improvement:
          'Ask about suicide plainly. It is how you learn whether she is safe.',
        recommendation: 'Are you thinking about ending your life?',
      },
    ]);
    const evidence = {
      emotional_movement: [
        { turn_index: 2, level: -3 },
        { turn_index: 4, level: 9 },
        { turn_index: 99, level: 1 },
      ],
    };
    const messageFor = (t: number) => (t === 99 ? undefined : 100 + t);
    expect(
      emotionalMovementFromEvidence(evidence, messageFor, (id) =>
        id === 102 ? 12.5 : undefined,
      ),
    ).toEqual([
      { messageId: '102', level: -3, startTime: 12.5 },
      { messageId: '104', level: 5 },
    ]);
  });

  it('lists strengths and points to work on as the groundedness judge reads them', () => {
    expect(claimsFromCards(cards)).toEqual({
      positives: ['You named how heavy it felt. It helped her keep talking.'],
      improvements: [
        'Ask about suicide plainly. It is how you learn whether she is safe.',
      ],
    });
  });

  it('carries forward only what the learner was told', () => {
    expect(memoryUpdateFromCards(cards)).toEqual({
      focus_areas: ['Exploring risk'],
      trajectory: 'You stayed with Meena when she went quiet.',
      next_time: 'Exploring risk: Asking directly.',
    });
  });

  it('tells the Debrief agent’s feedback from today’s debrief', () => {
    expect(hasLegacyFeedback(undefined)).toBe(false);
    // Unstamped feedback is always today's debrief's, as before.
    expect(hasLegacyFeedback({ positives: [] })).toBe(true);
    expect(
      hasLegacyFeedback({ supervisorNote: 'x', debriefGenerator: {} }),
    ).toBe(false);
    expect(
      hasLegacyFeedback({ supervisorNote: 'x', emotionalMovement: [] }),
    ).toBe(true);
  });

  it('reads an organisation as not live when the read fails', async () => {
    const ds = {
      query: jest.fn(async () => {
        throw new Error('down');
      }),
    };
    expect(await isDebriefAgentLiveForSession(ds as any, 's1')).toBe(false);
    ds.query.mockResolvedValueOnce([{ '?column?': 1 }] as never);
    expect(await isDebriefAgentLiveForSession(ds as any, 's1')).toBe(true);
  });
});

function build(summary: Record<string, any> | null) {
  const queries: Array<{ sql: string; params: any[] }> = [];
  const em = {
    query: jest.fn(async (sql: string, params: any[]) => {
      queries.push({ sql, params });
      if (sql.includes('SELECT summary')) return summary ? [{ summary }] : [];
      return [];
    }),
  };
  const runs = {
    manager: { transaction: async (f: (e: any) => Promise<void>) => f(em) },
    query: jest.fn(async (sql: string) =>
      String(sql).includes('scenario_session_messages')
        ? [
            { id: 501, content: 'Hi', start: 0 },
            { id: 502, content: '', start: 1 },
            { id: 503, content: "I don't see the point.", start: 3 },
          ]
        : [{ counselor_id: 7 }],
    ),
    findOne: jest.fn(),
  };
  const memory = { recordFromEvaluation: jest.fn(async () => undefined) };
  const events = { emit: jest.fn() };
  const svc = new DebriefPublishService(
    runs as any,
    memory as any,
    events as any,
  );
  return { svc, queries, memory, events, runs };
}

const run = (over: Record<string, any> = {}) =>
  ({
    id: 'run-1',
    scenarioSessionId: 's1',
    tenantId: 't1',
    mode: DebriefRunMode.LIVE,
    status: DebriefRunStatus.PUBLISHED,
    releaseId: 'rel-1',
    releaseVersion: 3,
    cards,
    language: 'ml-IN',
    workspace: {
      evidence: {
        behaviours: [
          {
            coverage_category: 'Emotional Attunement',
            opportunity: true,
            observation: 'observed',
          },
        ],
        emotional_movement: [{ turn_index: 2, level: -2 }],
        case_memory_update: 'She carries the exam worry forward.',
      },
    },
    ...over,
  }) as any;

describe('DebriefPublishService', () => {
  it('writes the live debrief into the session, keeps today’s note once, and announces', async () => {
    const { svc, queries, memory, events } = build({
      feedback: {
        supervisorNote: 'Old note',
        skillCoverage: [{ category: 'Listening Engagement', percentage: 40 }],
        emotionalMovement: [{ message_id: '1', level: 2 }],
      },
    });
    expect(await svc.applyToSession(run())).toBe(true);

    const legacy = queries.find((q) => q.sql.includes('{legacyNote}'))!;
    expect(JSON.parse(legacy.params[1])).toMatchObject({
      supervisorNote: 'Old note',
      skillCoverage: [{ category: 'Listening Engagement', percentage: 40 }],
    });

    const write = queries.find((q) =>
      q.sql.includes('UPDATE scenario_session_details'),
    )!;
    const ours = JSON.parse(write.params[1]);
    expect(ours.supervisorNote).toContain('You stayed with Meena');
    // Turn 2 is the second non-empty message (503): the anchor lands on it.
    expect(ours.supervisorNote).toContain('[[msg:503]]');
    expect(ours.emotionalMovement).toEqual([
      { messageId: '503', level: -2, startTime: 3 },
    ]);
    expect(ours.cumulativeMemory).toBe('She carries the exam worry forward.');
    expect(ours.areasOfGrowth).toHaveLength(1);
    expect(write.params[2]).toBe('ml');
    expect(ours.skillCoverage).toEqual([
      { category: 'Emotional Attunement', percentage: 100 },
    ]);
    expect(ours.debriefGenerator).toMatchObject({
      agent: 'debrief',
      runId: 'run-1',
      releaseId: 'rel-1',
      version: 3,
    });
    // Merged over today's feedback, so emotional movement stays.
    expect(write.sql).toContain(
      "coalesce(summary->'feedback', '{}'::jsonb) || $2::jsonb",
    );

    expect(memory.recordFromEvaluation).toHaveBeenCalledWith(
      7,
      't1',
      's1',
      expect.objectContaining({ focus_areas: ['Exploring risk'] }),
    );
    expect(events.emit).toHaveBeenCalledWith(
      SCENARIO_SESSION_DEBRIEF_READY_EVENT,
      {
        scenarioSessionId: 's1',
        tenantId: 't1',
      },
    );
  });

  it('does not take the legacy copy twice, and a re-apply does not announce again', async () => {
    const { svc, queries, memory, events } = build({
      feedback: {
        supervisorNote: 'Our note',
        debriefGenerator: { agent: 'debrief', runId: 'run-1' },
      },
    });
    await svc.applyToSession(run(), { announce: false });
    expect(queries.some((q) => q.sql.includes('{legacyNote}'))).toBe(false);
    expect(memory.recordFromEvaluation).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('leaves today’s skill coverage alone when the evidence map has no area tags', async () => {
    const { svc, queries } = build({ feedback: { supervisorNote: 'Old' } });
    await svc.applyToSession(
      run({ workspace: { evidence: { behaviours: [] } } }),
    );
    const write = queries.find((q) =>
      q.sql.includes('UPDATE scenario_session_details'),
    )!;
    expect(JSON.parse(write.params[1])).not.toHaveProperty('skillCoverage');
  });

  it('creates the summary when today’s debrief has not written one yet', async () => {
    const { svc, queries } = build(null);
    await svc.applyToSession(run());
    expect(
      queries.some((q) =>
        q.sql.includes('INSERT INTO scenario_session_details'),
      ),
    ).toBe(true);
  });

  it('writes nothing for a shadow run, or one the learner cannot read', async () => {
    for (const over of [
      { mode: DebriefRunMode.SHADOW },
      { status: DebriefRunStatus.NEEDS_PERSON },
      { cards: null },
    ]) {
      const { svc, queries, events } = build({ feedback: {} });
      expect(await svc.applyToSession(run(over))).toBe(false);
      expect(queries).toHaveLength(0);
      expect(events.emit).not.toHaveBeenCalled();
    }
  });

  it('never throws when the write fails', async () => {
    const { svc, runs } = build({ feedback: {} });
    runs.manager.transaction = async () => {
      throw new Error('db down');
    };
    expect(await svc.applyToSession(run())).toBe(false);
  });
});
