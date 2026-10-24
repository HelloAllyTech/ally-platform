import { AgentLessonScope } from 'src/llm-agent/harness/enum/learning.enum';
import {
  GUIDE_DEFAULT_BUNDLE,
  GUIDE_DEFAULT_LOOP_POLICY,
  GuidePlaybookLesson,
  GuideReleaseBundle,
} from 'src/guide/release/guide-release.bundle';
import { GUIDE_POLICY_SCHEMA } from 'src/guide/release/policy.schema';
import { CopiedTextIndex } from '../copied-text';
import { EvidenceCluster, buildClusters, evidenceSuffices } from '../evidence';
import {
  ProposedChange,
  VetInput,
  buildCandidateBundle,
  countPlaybook,
  currentPlaybook,
  vetChanges,
} from '../guardrails';
import { safetyTermsIn } from '../safety-vocabulary';
import { parseCuratorOutput } from '../guide-curator.service';

const policy = GUIDE_DEFAULT_LOOP_POLICY;

const cluster = (
  over: Partial<EvidenceCluster> & Pick<EvidenceCluster, 'id'>,
): EvidenceCluster => ({
  signal: 'criterion:autonomy',
  scope: AgentLessonScope.PLATFORM,
  tenantId: null,
  trackId: null,
  turns: 10,
  learners: 6,
  tenants: 3,
  sources: { critic: 10 },
  evaluationIds: [],
  reasons: [],
  ...over,
});

const lesson = (clusterId: string, text: string): ProposedChange => ({
  kind: 'lesson',
  clusterId,
  text,
  rationale: 'because',
});

function vet(
  changes: ProposedChange[],
  over: Partial<VetInput> = {},
  clusters: EvidenceCluster[] = [
    cluster({ id: 'p1' }),
    cluster({
      id: 'o1',
      scope: AgentLessonScope.ORG,
      tenantId: 't1',
      learners: 5,
      tenants: 1,
    }),
    cluster({
      id: 'c1',
      scope: AgentLessonScope.COURSE,
      trackId: 'tr1',
      learners: 5,
    }),
  ],
) {
  return vetChanges({
    changes,
    clusters: new Map(clusters.map((c) => [c.id, c])),
    bundle: GUIDE_DEFAULT_BUNDLE,
    schema: GUIDE_POLICY_SCHEMA,
    copied: new CopiedTextIndex(
      [
        'my supervisor never listens to me when I talk about the hard calls at night',
      ],
      policy.copyNgram,
    ),
    activeCounts: countPlaybook([]),
    knownHashes: new Set(),
    policy,
    ...over,
  });
}

describe('evidence thresholds (Appendix A)', () => {
  it('a platform lesson needs 2+ learners across 2+ organisations', () => {
    expect(
      evidenceSuffices(
        { scope: AgentLessonScope.PLATFORM, learners: 2, tenants: 2 },
        policy,
      ).ok,
    ).toBe(true);
    expect(
      evidenceSuffices(
        { scope: AgentLessonScope.PLATFORM, learners: 9, tenants: 1 },
        policy,
      ).ok,
    ).toBe(false);
    expect(
      evidenceSuffices(
        { scope: AgentLessonScope.PLATFORM, learners: 1, tenants: 2 },
        policy,
      ).ok,
    ).toBe(false);
  });

  it('an organisation or course lesson needs 5+ learners', () => {
    for (const scope of [AgentLessonScope.ORG, AgentLessonScope.COURSE]) {
      expect(
        evidenceSuffices({ scope, learners: 5, tenants: 1 }, policy).ok,
      ).toBe(true);
      expect(
        evidenceSuffices({ scope, learners: 4, tenants: 1 }, policy).ok,
      ).toBe(false);
    }
  });

  it('counts each failure platform-wide, for its organisation and for its course', () => {
    const rows = ['u:1', 'u:2', 'u:3'].map((learner, i) => ({
      signal: 'criterion:autonomy',
      source: 'critic' as const,
      turnId: `turn-${i}`,
      evaluationId: `e-${i}`,
      learner,
      tenantId: i === 2 ? 't2' : 't1',
      trackId: 'tr1',
      reason: 'decided for the learner',
    }));
    const clusters = buildClusters(rows);
    const by = (scope: string, key?: string) =>
      clusters.find(
        (c) =>
          c.scope === scope &&
          (key === undefined || c.tenantId === key || c.trackId === key),
      )!;
    expect(by('platform')).toMatchObject({ learners: 3, tenants: 2, turns: 3 });
    expect(by('org', 't1')).toMatchObject({ learners: 2 });
    expect(by('course', 'tr1')).toMatchObject({ learners: 3 });
    expect(by('platform').reasons).toEqual(['decided for the learner']);
  });

  it('blocks a lesson whose cited evidence falls short, or that cites nothing offered', () => {
    const verdicts = vet(
      [
        lesson(
          'thin',
          'Offer the learner a choice of next step before suggesting one.',
        ),
        lesson(
          'made-up',
          'Offer the learner a choice of next step before suggesting one.',
        ),
      ],
      {},
      [cluster({ id: 'thin', tenants: 1 })],
    );
    expect(verdicts.map((v) => v.reason)).toEqual([
      'evidence',
      'unknown_evidence',
    ]);
  });
});

describe('the 8-gram copied-text check', () => {
  it('blocks a lesson that repeats eight words of a learner message', () => {
    const [verdict] = vet([
      lesson(
        'p1',
        'When they say my supervisor never listens to me when I talk, slow down.',
      ),
    ]);
    expect(verdict.outcome).toBe('block');
    expect(verdict.reason).toBe('copied_text');
  });

  it('lets seven shared words through, and matches across case and punctuation', () => {
    const index = new CopiedTextIndex(
      ['One two three four five six seven eight'],
      8,
    );
    expect(index.firstCopied('one two three four five six seven')).toBeNull();
    expect(
      index.firstCopied('ONE, two; three four five six seven eight!'),
    ).toBe('one two three four five six seven eight');
  });

  it('checks the replacement text of a prompt tweak too', () => {
    const prompt = GUIDE_DEFAULT_BUNDLE.prompts.tutor!.text;
    const find = prompt.slice(0, 60);
    const [verdict] = vet([
      {
        kind: 'prompt',
        clusterId: 'p1',
        text: 'Edit the tutor instructions',
        rationale: 'x',
        prompt: {
          role: 'tutor',
          find,
          replace:
            'If a learner says my supervisor never listens to me when I talk, be gentle.',
        },
      },
    ]);
    expect(verdict.reason).toBe('copied_text');
  });
});

describe('pinned keys and the safety core', () => {
  const tweak = (key: string, value: number): ProposedChange => ({
    kind: 'policy',
    clusterId: 'p1',
    text: `Set ${key}`,
    rationale: 'x',
    policy: { key, value },
  });

  it('never changes a pinned key, a Safety or Learning-loop key, or an unknown key', () => {
    const verdicts = vet([
      tweak('praiseMaxPerTurns', 5),
      tweak('safety.sentinelDeadlineMs', 2000),
      tweak('loop.lessonCapPlatform', 200),
      tweak('evaluator.dailyBudgetUsd', 100),
      tweak('no.such.key', 1),
    ]);
    expect(verdicts.map((v) => v.reason)).toEqual([
      'pinned',
      'pinned',
      'pinned',
      'protected_group',
      'unknown_key',
    ]);
  });

  it('keeps values inside the schema, refuses no-ops, and only from platform evidence', () => {
    const verdicts = vet([
      tweak('steer.l2OffSpineTurns', 99),
      tweak('steer.l2OffSpineTurns', 4),
      { ...tweak('steer.l2OffSpineTurns', 5), clusterId: 'o1' },
      tweak('steer.l2OffSpineTurns', 5),
    ]);
    expect(verdicts.map((v) => v.reason)).toEqual([
      'out_of_range',
      'no_change',
      'scope',
      null,
    ]);
    expect(verdicts[3]).toMatchObject({ outcome: 'accept', from: 4 });
  });

  it('never edits the Sentinel prompt, and needs an exact, unique passage', () => {
    const sentinel = GUIDE_DEFAULT_BUNDLE.prompts.sentinel!.text;
    const verdicts = vet([
      {
        kind: 'prompt',
        clusterId: 'p1',
        text: 'x',
        rationale: 'x',
        prompt: { role: 'sentinel', find: sentinel.slice(0, 40), replace: 'y' },
      },
      {
        kind: 'prompt',
        clusterId: 'p1',
        text: 'x',
        rationale: 'x',
        prompt: {
          role: 'tutor',
          find: 'not in the prompt at all',
          replace: 'y',
        },
      },
      {
        kind: 'prompt',
        clusterId: 'p1',
        text: 'x',
        rationale: 'x',
        prompt: { role: 'evaluator_critic', find: 'a', replace: 'y' },
      },
    ]);
    expect(verdicts.map((v) => v.reason)).toEqual([
      'safety_core',
      'find_not_unique',
      'protected_role',
    ]);
  });
});

describe('safety vocabulary goes to a person', () => {
  it('quarantines a lesson that touches risk, in English or Hindi', () => {
    const verdicts = vet([
      lesson(
        'p1',
        'When a learner mentions suicide in a case, ask what the course said.',
      ),
      lesson(
        'p1',
        'Agar learner aatmahatya ki baat kare to course ka hissa dikhao.',
      ),
    ]);
    expect(verdicts.map((v) => [v.outcome, v.reason])).toEqual([
      ['quarantine', 'safety_vocabulary'],
      ['quarantine', 'safety_vocabulary'],
    ]);
    expect(
      safetyTermsIn('A calm, plain explanation of the next step.'),
    ).toEqual([]);
  });

  it('carries a lesson a person cleared without quarantining it again', () => {
    const [verdict] = vet([
      {
        ...lesson(
          'approved:l1',
          'When a learner mentions suicide in a case, ask what the course said.',
        ),
        approved: {
          lessonId: 'l1',
          scope: AgentLessonScope.PLATFORM,
          tenantId: null,
          trackId: null,
          learners: 4,
        },
      },
    ]);
    expect(verdict.outcome).toBe('accept');
  });
});

describe('caps and the five-change limit', () => {
  const full = (scope: 'platform' | 'org' | 'course', n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `${scope}-${i}`,
      scope,
      tenantId: scope === 'org' ? 't1' : null,
      trackId: scope === 'course' ? 'tr1' : null,
      text: `lesson ${i}`,
    })) as GuidePlaybookLesson[];

  it('refuses a lesson over its scope cap: 60 platform, 15 per organisation, 10 per course', () => {
    const text =
      'Offer the learner a choice of next step before suggesting one.';
    const verdicts = vet(
      [lesson('p1', text), lesson('o1', `${text} `), lesson('c1', ` ${text}`)],
      {
        activeCounts: countPlaybook([
          ...full('platform', 60),
          ...full('org', 15),
          ...full('course', 10),
        ]),
      },
    );
    expect(verdicts.map((v) => v.reason)).toEqual(['cap', 'cap', 'cap']);
    // Another organisation's cap is its own.
    const other = vet([lesson('o1', text)], {
      activeCounts: countPlaybook(
        full('org', 15).map((l) => ({ ...l, tenantId: 't9' })),
      ),
    });
    expect(other[0].outcome).toBe('accept');
  });

  it('fills the last free slot with the best-evidenced lesson', () => {
    const verdicts = vet(
      [
        lesson(
          'weak',
          'Ask one question at a time when the learner seems unsure.',
        ),
        lesson(
          'strong',
          'Offer the learner a choice of next step before suggesting one.',
        ),
      ],
      { activeCounts: countPlaybook(full('platform', 59)) },
      [
        cluster({ id: 'weak', learners: 2, tenants: 2 }),
        cluster({ id: 'strong', learners: 9, tenants: 3 }),
      ],
    );
    expect(verdicts.map((v) => v.outcome)).toEqual(['block', 'accept']);
    expect(verdicts[0].reason).toBe('cap');
  });

  it('carries at most five changes in one release', () => {
    const changes = Array.from({ length: 7 }, (_, i) =>
      lesson(
        'p1',
        `Lesson number ${i}: offer one clear next step and stop there.`,
      ),
    );
    const verdicts = vet(changes);
    expect(verdicts.filter((v) => v.outcome === 'accept')).toHaveLength(5);
    expect(verdicts.filter((v) => v.reason === 'release_full')).toHaveLength(2);
  });

  it('refuses a lesson already proposed or active', () => {
    const change = lesson(
      'p1',
      'Offer the learner a choice of next step before suggesting one.',
    );
    const first = vet([change]);
    expect(first[0].outcome).toBe('accept');
    const { changeHash } = jest.requireActual('../guardrails');
    const again = vet([change], {
      knownHashes: new Set([changeHash(change, first[0])]),
    });
    expect(again[0].reason).toBe('duplicate');
  });
});

describe('the candidate bundle (the playbook frozen into the release)', () => {
  it('adds lessons by scope, freezes platform ones into lessonSnapshot, drops retired ones and applies tweaks', () => {
    const ga: GuideReleaseBundle = {
      ...GUIDE_DEFAULT_BUNDLE,
      lessonSnapshot: ['Old platform lesson.'],
      playbook: [
        { id: 'old', scope: 'platform', text: 'Old platform lesson.' },
        { id: 'gone', scope: 'platform', text: 'Retired lesson.' },
      ],
    };
    const verdicts = vet([
      lesson(
        'p1',
        'Offer the learner a choice of next step before suggesting one.',
      ),
      lesson(
        'o1',
        'Use the word "supervisor practice" the way this organisation does.',
      ),
      {
        kind: 'policy',
        clusterId: 'p1',
        text: 'x',
        rationale: 'x',
        policy: { key: 'steer.l2OffSpineTurns', value: 5 },
      },
    ]);
    const tutor = GUIDE_DEFAULT_BUNDLE.prompts.tutor!;
    const promptVerdict = vet([
      {
        kind: 'prompt',
        clusterId: 'p1',
        text: 'x',
        rationale: 'x',
        prompt: {
          role: 'tutor',
          find: tutor.text.slice(0, 50),
          replace: 'NEW OPENING. ',
        },
      },
    ])[0];
    const bundle = buildCandidateBundle(ga, {
      playbook: currentPlaybook(ga),
      retiredIds: new Set(['gone']),
      accepted: [
        ...verdicts.map((verdict, i) => ({ verdict, lessonId: `L${i}` })),
        { verdict: promptVerdict, lessonId: 'P' },
      ],
    });
    expect(bundle.playbook!.map((l) => [l.id, l.scope])).toEqual([
      ['old', 'platform'],
      ['L0', 'platform'],
      ['L1', 'org'],
    ]);
    expect(bundle.playbook![2].tenantId).toBe('t1');
    expect(bundle.lessonSnapshot).toEqual([
      'Old platform lesson.',
      'Offer the learner a choice of next step before suggesting one.',
    ]);
    expect(bundle.policy.steer.l2OffSpineTurns).toBe(5);
    expect(GUIDE_DEFAULT_BUNDLE.policy.steer.l2OffSpineTurns).toBe(4);
    expect(bundle.prompts.tutor!.version).toBe(tutor.version + 1);
    expect(bundle.prompts.tutor!.text.startsWith('NEW OPENING. ')).toBe(true);
  });

  it('reads a pre-curator release’s lessonSnapshot as platform lessons', () => {
    expect(
      currentPlaybook({ ...GUIDE_DEFAULT_BUNDLE, lessonSnapshot: ['A', 'B'] }),
    ).toEqual([
      { id: 'snapshot-0', scope: 'platform', text: 'A' },
      { id: 'snapshot-1', scope: 'platform', text: 'B' },
    ]);
  });
});

describe('parseCuratorOutput', () => {
  it('reads the three kinds and drops entries without evidence', () => {
    const changes = parseCuratorOutput(
      JSON.stringify({
        lessons: [
          { clusterId: 'p1', text: 'A lesson.', rationale: 'r' },
          { clusterId: '', text: 'No evidence.', rationale: 'r' },
        ],
        policyTweaks: [
          {
            clusterId: 'p1',
            key: 'steer.l2OffSpineTurns',
            value: 5,
            rationale: 'r',
          },
        ],
        promptTweaks: [
          {
            clusterId: 'p1',
            role: 'tutor',
            find: 'a',
            replace: 'b',
            rationale: 'r',
          },
        ],
      }),
    );
    expect(changes.map((c) => c.kind)).toEqual(['lesson', 'policy', 'prompt']);
    expect(changes[1].policy).toEqual({
      key: 'steer.l2OffSpineTurns',
      value: 5,
    });
  });
});
