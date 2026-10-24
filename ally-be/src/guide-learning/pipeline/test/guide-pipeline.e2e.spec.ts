import { AgentLesson } from 'src/llm-agent/entity/agent-lesson.entity';
import { AgentLessonAudit } from 'src/llm-agent/entity/agent-lesson-audit.entity';
import { AgentRelease } from 'src/llm-agent/entity/agent-release.entity';
import {
  AgentReleaseAuditAction,
  AgentReleaseAuthorKind,
  AgentReleaseStatus,
} from 'src/llm-agent/harness/enum/harness.enum';
import {
  AgentLessonAuditAction,
  AgentLessonStatus,
} from 'src/llm-agent/harness/enum/learning.enum';
import { AgentReleaseService } from 'src/llm-agent/harness/release/agent-release.service';
import {
  ALLY_GUIDE_AGENT_KEY,
  GUIDE_DEFAULT_BUNDLE,
  GuideReleaseBundle,
} from 'src/guide/release/guide-release.bundle';
import { GuideCuratorService } from '../../curator/guide-curator.service';
import { GuideLearningAuditService } from '../../curator/guide-learning-audit.service';
import { CanaryDecision } from '../canary-decision';
import { GuidePipelineService } from '../guide-pipeline.service';
import { fakeDb } from './fake-db';

const LESSON = 'Offer the learner a choice of next step before suggesting one.';
const LEARNER_WORDS =
  'i keep running out of time before my evening shift starts at the centre';

/** Six learners in two organisations, all failing a trusted criterion. */
const evaluations = Array.from({ length: 6 }, (_, i) => ({
  id: `eval-${i}`,
  turnId: `turn-${i}`,
  tenantId: i % 2 ? 't2' : 't1',
  trackId: 'track-1',
  userId: i + 1,
  visitorId: null,
  critic: {
    criteria: {
      autonomy: {
        verdict: 'fail',
        reason: 'Ally chose the next item for them',
      },
      // Untrusted criterion: never evidence.
      warmth: { verdict: 'fail', reason: 'cold' },
    },
  },
  deterministic: [],
}));

const decision = (action: CanaryDecision['action']): CanaryDecision => ({
  action,
  emergency: false,
  reasons: [`monitor says ${action}`],
  ready: action !== 'wait',
  thresholds: {},
  criteria: [],
  guard: { status: action === 'promote' ? 'pass' : 'pending', reason: 'x' },
});

async function setup() {
  const db = fakeDb((sql) => {
    if (sql.includes('FROM "agent_evaluations" e')) return evaluations;
    if (sql.includes('FROM "agent_reviews" r')) return [];
    if (sql.includes('FROM "guide_messages" m'))
      return [{ content: LEARNER_WORDS }];
    return [];
  });
  const releases = new AgentReleaseService(db.dataSource as never);
  const ga = (await releases.ensureSeed(
    ALLY_GUIDE_AGENT_KEY,
    GUIDE_DEFAULT_BUNDLE as unknown as Record<string, unknown>,
  ))!;
  const audit = new GuideLearningAuditService(
    db.repo(AgentLessonAudit) as never,
  );
  const models = {
    complete: jest.fn(async () => ({
      result: {
        stopReason: 'end_turn',
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              lessons: [
                {
                  clusterId: 'platform:criterion:autonomy:1',
                  text: LESSON,
                  rationale: 'they were steered',
                },
                {
                  clusterId: 'platform:criterion:autonomy:1',
                  text: `When a learner says ${LEARNER_WORDS}, offer a short item.`,
                  rationale: 'copied',
                },
                {
                  clusterId: 'platform:criterion:autonomy:1',
                  text: 'If a learner raises suicide in a case, point to the course section first.',
                  rationale: 'safety',
                },
                // The organisation clusters have 3 learners: under the bar.
                {
                  clusterId: 'org:criterion:autonomy:1',
                  text: 'An organisation lesson with thin evidence.',
                  rationale: 'thin',
                },
              ],
              policyTweaks: [
                {
                  clusterId: 'platform:criterion:autonomy:1',
                  key: 'praiseMaxPerTurns',
                  value: 2,
                  rationale: 'pinned',
                },
              ],
              promptTweaks: [],
            }),
          },
        ],
      },
      usd: 0.12,
      route: { provider: 'anthropic', model: 'claude-opus-5-5' },
      latencyMs: 10,
    })),
  };
  const curator = new GuideCuratorService(
    db.repo(AgentLesson) as never,
    db.dataSource as never,
    releases,
    models as never,
    { assertBudget: jest.fn(async () => 20) } as never,
    { trustedCriteria: jest.fn(async () => new Set(['autonomy'])) } as never,
    audit,
  );
  const stage = { value: 2 };
  const delegation = {
    effectiveStage: jest.fn(async () => ({ stage: stage.value })),
  };
  // The gate and the shadow are covered by their own specs; here they pass
  // and record through the real release service, as the real ones do.
  const runs = {
    start: jest.fn(async (releaseId: string) => {
      await releases.recordEvalRun({
        releaseId,
        runId: 'run-1',
        phase: 'started',
        userId: null,
      });
      await releases.recordEvalRun({
        releaseId,
        runId: 'run-1',
        phase: 'passed',
        userId: null,
      });
      return { id: 'run-1' };
    }),
    get: jest.fn(async () => ({
      id: 'run-1',
      summary: { decision: { reasons: [] } },
    })),
  };
  const report = { id: 'shadow-1', status: 'passed', summary: { reasons: [] } };
  const shadows = {
    run: jest.fn(async (releaseId: string) => {
      await releases.recordShadow({
        releaseId,
        reportId: report.id,
        phase: 'started',
        userId: null,
      });
      await releases.recordShadow({
        releaseId,
        reportId: report.id,
        phase: 'passed',
        userId: null,
      });
      return report;
    }),
    get: jest.fn(async () => report),
  };
  const monitor = {
    decide: jest.fn(async () => ({ decision: decision('wait') })),
  };
  const pipeline = new GuidePipelineService(
    releases,
    delegation as never,
    curator,
    runs as never,
    shadows as never,
    monitor as never,
    audit,
  );
  return {
    db,
    releases,
    ga,
    curator,
    pipeline,
    stage,
    monitor,
    runs,
    shadows,
    models,
  };
}

describe('a curator proposal through gate → shadow → canary → decision (M4 exit)', () => {
  it('ships one guarded lesson to GA with a complete audit trail', async () => {
    const t = await setup();
    const lessons = t.db.repo(AgentLesson).rows;

    // 1. The curator proposes. Guardrails keep one lesson.
    const report = await t.curator.run({ userId: null });
    expect(report).toMatchObject({ accepted: 1, quarantined: 1 });
    expect(report.byReason).toMatchObject({
      accepted: 1,
      copied_text: 1,
      safety_vocabulary: 1,
      unknown_evidence: 1,
      pinned: 1,
    });
    const draft = (await t.releases.getById(report.releaseId!)) as AgentRelease;
    expect(draft.status).toBe(AgentReleaseStatus.DRAFT);
    expect(draft.authorKind).toBe(AgentReleaseAuthorKind.CURATOR);
    const bundle = draft.bundle as unknown as GuideReleaseBundle;
    expect(bundle.lessonSnapshot).toEqual([LESSON]);
    expect(bundle.playbook).toEqual([
      expect.objectContaining({ scope: 'platform', text: LESSON }),
    ]);
    // Nothing a learner wrote is stored, even on the blocked row.
    expect(JSON.stringify(lessons)).not.toContain('evening shift');
    // The model saw judge reasons, never learner text.
    expect(JSON.stringify(t.models.complete.mock.calls)).not.toContain(
      'evening shift',
    );

    // One proposal in the pipeline at a time.
    expect((await t.curator.run({ userId: null })).skipped).toMatch(
      /one proposal/,
    );

    // 2. Stage 2: the gate runs on its own and passes.
    await t.pipeline.advance();
    expect((await t.releases.getById(draft.id)).status).toBe(
      AgentReleaseStatus.CANDIDATE,
    );
    // 3. Shadow.
    await t.pipeline.advance();
    expect((await t.releases.getById(draft.id)).status).toBe(
      AgentReleaseStatus.SHADOW,
    );
    // 4. Canary at the policy's share.
    await t.pipeline.advance();
    const inCanary = await t.releases.getById(draft.id);
    expect(inCanary.status).toBe(AgentReleaseStatus.CANARY);
    expect(inCanary.rolloutPercent).toBe(20);
    // 5. Not enough data yet: wait, recorded once however often it runs.
    await t.pipeline.advance();
    await t.pipeline.advance();
    // 6. Promote is decided; at stage 2 a person promotes, so it holds.
    t.monitor.decide.mockResolvedValue({ decision: decision('promote') });
    await t.pipeline.advance();
    expect((await t.releases.getById(draft.id)).status).toBe(
      AgentReleaseStatus.CANARY,
    );
    // 7. At stage 3 it promotes itself.
    t.stage.value = 3;
    await t.pipeline.advance();
    expect((await t.releases.getById(draft.id)).status).toBe(
      AgentReleaseStatus.GA,
    );
    expect((await t.releases.getById(t.ga.id)).status).toBe(
      AgentReleaseStatus.RETIRED,
    );
    const shipped = lessons.find((l) => l.text === LESSON)!;
    expect(shipped.status).toBe(AgentLessonStatus.ACTIVE);

    const { trail } = await t.pipeline.trail(draft.id);
    const releaseSteps = trail
      .filter((row) => row.source === 'release')
      .map((row) => [
        row.action,
        row.actorKind,
        (row.detail as any)?.to ?? (row.detail as any)?.action ?? null,
      ]);
    expect(releaseSteps).toEqual([
      [AgentReleaseAuditAction.CREATED, AgentReleaseAuthorKind.CURATOR, null],
      [
        AgentReleaseAuditAction.STATUS_CHANGED,
        AgentReleaseAuthorKind.SYSTEM,
        AgentReleaseStatus.EVALUATING,
      ],
      [
        AgentReleaseAuditAction.STATUS_CHANGED,
        AgentReleaseAuthorKind.SYSTEM,
        AgentReleaseStatus.CANDIDATE,
      ],
      [
        AgentReleaseAuditAction.SHADOW_STARTED,
        AgentReleaseAuthorKind.SYSTEM,
        AgentReleaseStatus.SHADOW,
      ],
      [
        AgentReleaseAuditAction.SHADOW_COMPLETED,
        AgentReleaseAuthorKind.SYSTEM,
        AgentReleaseStatus.SHADOW,
      ],
      [
        AgentReleaseAuditAction.CANARY_STARTED,
        AgentReleaseAuthorKind.SYSTEM,
        null,
      ],
      [
        AgentReleaseAuditAction.CANARY_DECIDED,
        AgentReleaseAuthorKind.SYSTEM,
        'wait',
      ],
      [
        AgentReleaseAuditAction.CANARY_DECIDED,
        AgentReleaseAuthorKind.SYSTEM,
        'promote',
      ],
      [AgentReleaseAuditAction.PROMOTED, AgentReleaseAuthorKind.SYSTEM, null],
    ]);
    const learningSteps = trail
      .filter((row) => row.source === 'learning')
      .map((row) =>
        row.action === AgentLessonAuditAction.PIPELINE_STEP
          ? (row.detail as any).step
          : row.action,
      );
    expect(learningSteps).toEqual([
      AgentLessonAuditAction.CURATOR_RUN,
      'gate_started',
      'shadow_ran',
      'canary_started',
      'promoted',
      AgentLessonAuditAction.ACTIVATED,
    ]);
    // Each lesson decision is audited with its reason.
    const lessonAudit = t.db
      .repo(AgentLessonAudit)
      .rows.filter((row) => row.lessonId)
      .map((row) => [row.action, row.detail?.reason ?? null]);
    expect(lessonAudit).toEqual(
      expect.arrayContaining([
        [AgentLessonAuditAction.PROPOSED, null],
        [AgentLessonAuditAction.BLOCKED, 'copied_text'],
        [AgentLessonAuditAction.QUARANTINED, 'safety_vocabulary'],
        [AgentLessonAuditAction.BLOCKED, 'pinned'],
        [AgentLessonAuditAction.ACTIVATED, null],
      ]),
    );
  });

  it('reverts on its own at stage 1, and rejects the lessons the canary carried', async () => {
    const t = await setup();
    const report = await t.curator.run({ userId: null });
    t.stage.value = 1;
    // Stage 1: nothing moves on its own.
    await t.pipeline.advance();
    expect(t.runs.start).not.toHaveBeenCalled();
    // A person puts it in canary; the monitor reverts it anyway.
    await t.releases.startCanary(report.releaseId!, 10, 42);
    t.monitor.decide.mockResolvedValue({
      decision: { ...decision('revert'), emergency: true },
    });
    await t.pipeline.advance();
    const release = await t.releases.getById(report.releaseId!);
    expect(release.status).toBe(AgentReleaseStatus.RETIRED);
    const audit = t.db.repo(AgentRelease).rows.length; // releases intact
    expect(audit).toBe(2);
    const reverted = (await t.releases.auditFor(release.id)).filter(
      (row) => row.action === AgentReleaseAuditAction.CANARY_REVERTED,
    );
    expect(reverted).toHaveLength(1);
    expect(reverted[0]).toMatchObject({
      actorKind: AgentReleaseAuthorKind.SYSTEM,
      actorUserId: null,
    });
    expect(
      (await t.releases.auditFor(release.id)).some(
        (row) => row.action === AgentReleaseAuditAction.EMERGENCY_ROLLBACK,
      ),
    ).toBe(true);
    const lesson = t.db.repo(AgentLesson).rows.find((l) => l.text === LESSON)!;
    expect(lesson.status).toBe(AgentLessonStatus.REJECTED);
  });

  it('retires a curator draft whose gate failed, so the next proposal can start', async () => {
    const t = await setup();
    const report = await t.curator.run({ userId: null });
    t.runs.start.mockImplementationOnce(async (releaseId: string) => {
      await t.releases.recordEvalRun({
        releaseId,
        runId: 'run-2',
        phase: 'started',
        userId: null,
      });
      await t.releases.recordEvalRun({
        releaseId,
        runId: 'run-2',
        phase: 'failed',
        userId: null,
      });
      return { id: 'run-2' };
    });
    await t.pipeline.advance(); // gate fails → back to DRAFT
    await t.pipeline.advance(); // → retired
    expect((await t.releases.getById(report.releaseId!)).status).toBe(
      AgentReleaseStatus.RETIRED,
    );
    expect(await t.curator.inFlight()).toBeNull();
  });
});
