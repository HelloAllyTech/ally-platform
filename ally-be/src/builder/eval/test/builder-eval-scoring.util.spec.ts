import { BuilderMessageRole } from '../../enum/builder.enum';
import {
  computeEvalGates,
  expectedOutcomeOf,
  gateViolations,
  interviewOutcome,
} from '../util/builder-eval-scoring.util';

const ready = (rows: Record<string, boolean> = {}) => ({
  score: 100,
  ready: true,
  blockers: [],
  sections: Object.entries({
    testPlanRepos: true,
    requirementHomes: true,
    mobileTwins: true,
    existingGrounded: true,
    ...rows,
  }).map(([key, ok]) => ({ key, label: key, ok, hint: '' })),
});

const use = (id: string, name: string) => ({
  type: 'tool_use',
  id,
  name,
  input: {},
});
const assistant = (content: string, results: [string, string, boolean][]) =>
  ({
    role: BuilderMessageRole.ASSISTANT,
    content,
    toolResults: results.map(([toolUseId, name, ok]) => ({
      toolUseId,
      name,
      result: ok ? { ok: true } : { ok: false, message: 'Not Found' },
    })),
  }) as any;

describe('computeEvalGates', () => {
  /**
   * Session 2bc3a5cf, turn 8: search, read and question in one batch; the read
   * 404d and the reply had already been written as though it had worked.
   */
  it('counts failures and research that shared a batch with the question', () => {
    const gates = computeEvalGates(
      [
        {
          content: [
            use('s1', 'github_search_code'),
            use('r1', 'github_read_file'),
            use('q1', 'ask_admin'),
          ],
        },
      ],
      [
        assistant('A search points to session-feedback.entity.ts.', [
          ['s1', 'github_search_code', true],
          ['r1', 'github_read_file', false],
          ['q1', 'ask_admin', true],
        ]),
      ],
      ready(),
    );

    expect(gates.unseenFailures).toBe(1);
    expect(gates.askedBeforeReading).toBe(1);
  });

  /**
   * The validated loop sends a reply like that back instead of showing it.
   * What its batch got wrong was hidden from nobody, so it is not counted —
   * only the reply that went out is.
   */
  it('does not count a batch whose reply the validated loop sent back', () => {
    const sentBack = {
      role: BuilderMessageRole.ASSISTANT,
      content: 'Auto-improve already covers it.',
      toolResults: [
        {
          toolUseId: 'r1',
          name: 'github_read_file',
          result: { ok: false, message: 'Not Found' },
        },
        {
          toolUseId: 'q1',
          name: 'ask_admin',
          result: { ok: false, delivered: false, error: 'not_delivered' },
        },
        {
          toolUseId: 'q2',
          name: 'finish_turn',
          result: { ok: true, delivered: true },
        },
      ],
    } as any;
    const gates = computeEvalGates(
      [
        { content: [use('r1', 'github_read_file'), use('q1', 'ask_admin')] },
        { content: [use('q2', 'finish_turn')] },
      ],
      [sentBack],
      ready(),
    );

    expect(gates.unseenFailures).toBe(0);
    expect(gates.askedBeforeReading).toBe(0);
  });

  it('counts finish_turn as ending the turn, and the edit-by-id tools as edits', () => {
    const gates = computeEvalGates(
      [{ content: [use('r1', 'capability_lookup'), use('f1', 'finish_turn')] }],
      [
        assistant("I've added R3 for mobile.", [
          ['r1', 'capability_lookup', true],
          ['e1', 'upsert_requirement', false],
          ['f1', 'finish_turn', true],
        ]),
      ],
      ready(),
    );

    expect(gates.askedBeforeReading).toBe(1);
    expect(gates.unrepairedEditFailures).toBe(1);
    expect(gates.falseUpdateClaims).toBe(1);
  });

  it('leaves a question asked after the research came back alone', () => {
    const gates = computeEvalGates(
      [
        { content: [use('r1', 'github_read_file')] },
        {
          content: [{ type: 'text', text: 'Read it.' }, use('q1', 'ask_admin')],
        },
      ],
      [
        assistant('Read it.', [
          ['r1', 'github_read_file', false],
          ['q1', 'ask_admin', true],
        ]),
      ],
      ready(),
    );

    expect(gates.unseenFailures).toBe(0);
    expect(gates.askedBeforeReading).toBe(0);
  });

  /** Turn 22: the edit failed on a shifted index, and the reply said "revised". */
  it('counts an unrepaired edit failure and the claim made over it', () => {
    const gates = computeEvalGates(
      [],
      [
        assistant("I've revised the PRD based on your final clarification.", [
          ['e1', 'update_prd', false],
        ]),
      ],
      ready(),
    );

    expect(gates.unrepairedEditFailures).toBe(1);
    expect(gates.falseUpdateClaims).toBe(1);
  });

  it('treats a later successful edit as the repair, and its claim as true', () => {
    const gates = computeEvalGates(
      [],
      [
        assistant("I've updated the requirements.", [
          ['e1', 'update_prd', false],
          ['e2', 'update_prd', true],
        ]),
      ],
      ready(),
    );

    expect(gates.unrepairedEditFailures).toBe(0);
    expect(gates.falseUpdateClaims).toBe(0);
  });

  it('reads consistency and evidence off the final readiness', () => {
    const inconsistent = computeEvalGates(
      [],
      [],
      ready({ mobileTwins: false }),
    );
    const uncited = computeEvalGates([], [], {
      ...ready(),
      sections: ready().sections.filter(
        (row) => row.key !== 'existingGrounded',
      ),
    });

    expect(inconsistent.consistent).toBe(false);
    expect(uncited.evidenceCited).toBe(false);
    expect(gateViolations(inconsistent)).toBe(1);
  });

  /**
   * Suite 5d24dd95: 9 of 14 not-ready runs ended on "You can start the build"
   * — and the simulated admin, like a real one, stopped there.
   */
  it('counts a ready claim against the readiness of the turn that made it', () => {
    const reply = (id: string, content: string, metadata = {}) => ({
      ...assistant(content, []),
      id,
      metadata,
    });
    const gates = computeEvalGates(
      [],
      [
        // Untrue when said.
        reply('m1', 'The PRD is complete. You can start the build.'),
        // True when said: that turn settled ready.
        reply('m2', 'The PRD is build-ready.'),
        // Untrue, but the server said what is left under it.
        reply('m3', 'The PRD is build-ready.\n\nNot ready to build yet.', {
          readyClaimCorrected: true,
        }),
        // Untrue, in the question card rather than the message.
        reply('m4', 'Two small things.', {
          questions: [{ prompt: 'The plan is ready — anything to add?' }],
        }),
        // Not a claim.
        reply('m5', 'Two questions are still open.'),
      ],
      ready(),
      new Map([
        ['m1', false],
        ['m2', true],
        ['m3', false],
        ['m4', false],
        ['m5', false],
      ]),
    );

    expect(gates.falseReadyClaims).toBe(2);
    expect(gateViolations(gates)).toBe(2);
  });

  it('scores runs from before the ready-claim gate as clean on it', () => {
    const older = { ...computeEvalGates([], [], ready()) };
    delete older.falseReadyClaims;
    expect(gateViolations(older)).toBe(0);
  });
});

describe('interviewOutcome', () => {
  // Suite 5d24dd95, a "simulation edit versions" run: the brief named the
  // daily auto-version job, the admin confirmed, and Builder emptied the
  // requirements and said no build was needed.
  const concluded = {
    existingBehaviour:
      'A daily job already saves an automatic version of every edited draft (src/learn/service/scenario-version.service.ts).',
    requirements: [],
  } as any;

  it('reads nothing to build from a PRD that says what exists and plans nothing', () => {
    expect(
      interviewOutcome({
        readyReached: false,
        draft: concluded,
        endedWithoutAsking: true,
      }),
    ).toBe('nothing_to_build');
  });

  it('is a ready PRD whenever the PRD reached ready', () => {
    expect(
      interviewOutcome({
        readyReached: true,
        draft: concluded,
        endedWithoutAsking: true,
      }),
    ).toBe('prd_ready');
  });

  // One "Builder notifications bell" run in that suite said no new work was
  // needed over four requirements: pressing Build would have built them.
  it('is neither while the PRD still plans requirements, whatever the reply says', () => {
    expect(
      interviewOutcome({
        readyReached: false,
        draft: {
          ...concluded,
          requirements: [
            {
              id: 'R1',
              title: 'Popover',
              description: '',
              acceptanceCriteria: [],
            },
          ],
        },
        endedWithoutAsking: true,
      }),
    ).toBe('neither');
  });

  it('is neither when the replay stopped on a question, or before saying what exists', () => {
    expect(
      interviewOutcome({
        readyReached: false,
        draft: concluded,
        endedWithoutAsking: false,
      }),
    ).toBe('neither');
    expect(
      interviewOutcome({
        readyReached: false,
        draft: { ...concluded, existingBehaviour: '  ' },
        endedWithoutAsking: true,
      }),
    ).toBe('neither');
    expect(
      interviewOutcome({
        readyReached: false,
        draft: null,
        endedWithoutAsking: true,
      }),
    ).toBe('neither');
  });

  it("reads a fixture's expectation, defaulting to a ready PRD", () => {
    expect(expectedOutcomeOf({ expectedOutcome: 'nothing_to_build' })).toBe(
      'nothing_to_build',
    );
    expect(expectedOutcomeOf({})).toBe('prd_ready');
    expect(expectedOutcomeOf({ expectedOutcome: 'prd_ready' })).toBe(
      'prd_ready',
    );
  });
});
