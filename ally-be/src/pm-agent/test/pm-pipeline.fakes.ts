import { randomUUID } from 'crypto';
import {
  AgentContentBlock,
  AgentToolDefinition,
  AgentTurnResult,
} from 'src/llm-agent/type/agent-llm.type';
import { PmAgentCard } from '../entity/pm-agent-card.entity';
import { PmAgentMemory } from '../entity/pm-agent-memory.entity';
import { PmAgentRun } from '../entity/pm-agent-run.entity';
import { PmAgentSettings } from '../entity/pm-agent-settings.entity';
import {
  PmCardCategory,
  PmCardKind,
  PmCardStatus,
  PmFeedbackStatus,
  PmRunStatus,
  PmRunTrigger,
} from '../enum/pm-agent.enum';
import {
  PM_CRITIC_SUBMIT_TOOL,
  PM_SUBMIT_TOOL,
} from '../constants/pm-agent-pipeline.constants';
import {
  PmLlmPort,
  PmLlmStepRequest,
  PmLlmStepResult,
  PmLlmTarget,
} from '../pipeline/pm-agent-llm.service';
import {
  PmDedupeItem,
  PmEvidenceRef,
  PmFeedbackTask,
  PmOutcomeRow,
  PmPersistInput,
  PmPersistResult,
  PmPipelineStore,
  PmToolbox,
  PmToolContext,
  PmToolOutcome,
} from '../pipeline/pm-pipeline.types';
import { estimateCallMaxUsd } from '../util/run-ledger';
import { fence } from '../util/fence.util';

/** Eight unrelated ideas, so candidates never dedupe against each other by accident. */
const IDEAS: [string, string, string][] = [
  [
    'Show streak count before each roleplay starts',
    '41% of learners without a visible streak skip the next day',
    'Render a streak chip beside the start button',
  ],
  [
    'Cache scenario catalogue responses for course pages',
    'Catalogue requests take 1800 ms at the 95th percentile',
    'Memoise the catalogue query for five minutes',
  ],
  [
    'Move transcript summaries to the fast model tier',
    'Summaries cost $212 last month across 9000 calls',
    'Point the summary task at the fast tier',
  ],
  [
    'Explain empty scribe history with a first-note prompt',
    '63% of new scribe users never open history again',
    'Replace the blank list with a guided prompt',
  ],
  [
    'Add retry around flaky webhook signature verification',
    'Webhook verification failed 27 times this week',
    'Wrap verification in one bounded retry',
  ],
  [
    'Surface unfinished track modules on the home dashboard',
    'Track completion stalls at module 3 for 48% of learners',
    'Add a resume tile for the next module',
  ],
  [
    'Split oversized analytics controller into per-chart handlers',
    'The controller has 2400 lines and 61 routes',
    'Extract chart handlers into separate files',
  ],
  [
    'Prefill coaching follow-up with the last session goal',
    'Only 22% of coaching sessions record a follow-up goal',
    'Copy the previous goal into the new form',
  ],
];

export const recFor = (
  index: number,
  evidenceIds: string[],
  over: Record<string, any> = {},
) => {
  const [title, why, change] = IDEAS[index % IDEAS.length];
  return {
    title,
    whyHeadline: why,
    change: [change],
    problem: `${title}: the current behaviour costs learners or the team time.`,
    plan: {
      steps: ['Read the current implementation', 'Make the change', 'Test it'],
      files: ['ally-be/src/example/example.service.ts'],
      acceptanceCriteria: ['The behaviour described in the title is visible'],
      testPlan: ['A jest spec for the new branch'],
      defaultsChosen: [
        'Keep the existing API shape: nothing else depends on it',
      ],
    },
    size: 'S',
    risk: 'low',
    riskWhy: 'Contained to one module',
    rollbackNote: 'Revert the pull request',
    impactMetric: { name: 'weekly active learners', direction: 'up' },
    alternativesDropped: ['A larger redesign'],
    repos: ['ally-be'],
    evidenceIds,
    ...over,
  };
};

export const questionFor = (key: string, over: Record<string, any> = {}) => ({
  title: `Which audience should ${key} target first?`,
  askedBecause: 'Nothing in the data or docs says which audience matters more',
  usedFor: 'Choosing the rollout audience',
  options: [
    { label: 'Everyone', consequence: 'Fastest signal', suggested: true },
    { label: 'Supervisors only', consequence: 'Cleaner data' },
  ],
  scope: 'global',
  questionKey: key,
  ...over,
});

export const settingsRow = (
  over: Partial<PmAgentSettings> = {},
): PmAgentSettings =>
  ({
    id: 1,
    enabled: true,
    monthlyBudgetUsd: '100.00',
    queueCap: 5,
    runHourIst: 9,
    mandate: 'Focus on learner retention.',
    pauseAutoBuild: false,
    slackNotify: false,
    categoryWeights: null,
    autoBuildPaused: false,
    autoBuildPausedReason: null,
    autoBuildPausedAt: null,
    consecutiveBuildFailures: 0,
    ...over,
  }) as PmAgentSettings;

/** In-memory PmPipelineStore with the same guards as the SQL one. */
export class FakePipelineStore implements PmPipelineStore {
  settings = settingsRow();
  cards: PmAgentCard[] = [];
  runs: PmAgentRun[] = [];
  committedUsd = 0;
  feedback: (PmFeedbackTask & {
    status: string;
    successorCardId?: string | null;
  })[] = [];
  memory: PmAgentMemory[] = [];
  outcomes: PmOutcomeRow[] = [];
  corpus: PmDedupeItem[] = [];
  suppressed = new Set<string>();
  uxSignals = true;
  gateTraces: { layer: string; detail: Record<string, unknown> }[] = [];
  shown: string[] = [];
  learned: { dimension: string; key: string; score: number }[] = [];

  async getSettings() {
    return this.settings;
  }
  async countOpen() {
    return this.cards.filter((c) => c.status === PmCardStatus.OPEN).length;
  }
  async findRunning() {
    return this.runs.find((r) => r.status === PmRunStatus.RUNNING) ?? null;
  }
  async startRun(input: {
    trigger: PmRunTrigger;
    triggeredBy: number | null;
    reservedUsd: number;
    runDate: string;
  }) {
    if (this.runs.some((r) => r.status === PmRunStatus.RUNNING)) return null;
    const run = {
      id: randomUUID(),
      status: PmRunStatus.RUNNING,
      trigger: input.trigger,
      runDate: input.runDate,
      reservedUsd: input.reservedUsd.toFixed(4),
      spentUsd: '0',
      cardsCreated: 0,
      startedAt: new Date(),
      triggeredBy: input.triggeredBy,
    } as PmAgentRun;
    this.runs.push(run);
    return run;
  }
  async recordSkippedRun(input: {
    trigger: PmRunTrigger;
    triggeredBy: number | null;
    stopReason: string;
    runDate: string;
  }) {
    const run = {
      id: randomUUID(),
      status: PmRunStatus.SKIPPED,
      trigger: input.trigger,
      runDate: input.runDate,
      stopReason: input.stopReason,
    } as PmAgentRun;
    this.runs.push(run);
    return run.id;
  }
  async finishRun(id: string, patch: Partial<PmAgentRun>) {
    Object.assign(this.runs.find((r) => r.id === id)!, patch);
  }
  async updateRunSpend(id: string, spentUsd: number) {
    this.runs.find((r) => r.id === id)!.spentUsd = spentUsd.toFixed(4);
  }
  async failStaleRuns() {
    return 0;
  }
  async hasRunFor(runDate: string, trigger: PmRunTrigger) {
    return this.runs.some(
      (r) => r.runDate === runDate && r.trigger === trigger,
    );
  }
  async recentRunLanes() {
    return [] as string[][];
  }
  async monthCommittedUsd() {
    return this.committedUsd;
  }
  async pendingFeedback(limit: number, onlyId?: string) {
    return this.feedback
      .filter(
        (f) =>
          f.status === PmFeedbackStatus.PENDING && (!onlyId || f.id === onlyId),
      )
      .slice(0, limit);
  }
  async moveFeedback(
    id: string,
    from: string[],
    to: string,
    successorCardId?: string | null,
  ) {
    const row = this.feedback.find((f) => f.id === id);
    if (!row || !from.includes(row.status)) return false;
    row.status = to;
    if (successorCardId !== undefined) row.successorCardId = successorCardId;
    return true;
  }
  async dedupeCorpus() {
    return this.corpus;
  }
  async isQuestionSuppressed(key: string) {
    return this.suppressed.has(key);
  }
  async activeMemory() {
    return this.memory;
  }
  async outcomeRows() {
    return this.outcomes;
  }
  async saveLearnedScores(
    rows: { dimension: 'category' | 'lane'; key: string; score: number }[],
  ) {
    this.learned = rows;
  }
  async bumpShown(category: string, lane: string) {
    this.shown.push(`${category}/${lane}`);
  }
  async tenantNames() {
    return ['Acme Health'];
  }
  async hasUxSignals() {
    return this.uxSignals;
  }
  async persistCard(input: PmPersistInput): Promise<PmPersistResult> {
    if (
      this.cards.some(
        (c) =>
          c.versionHash === input.versionHash &&
          (c.runId === input.runId || c.status === PmCardStatus.OPEN),
      )
    ) {
      return { status: 'duplicate' };
    }
    if ((await this.countOpen()) >= input.queueCap) {
      return { status: 'queue_full' };
    }
    const card = {
      id: randomUUID(),
      runId: input.runId,
      kind: input.candidate.kind,
      category: input.candidate.category,
      status: PmCardStatus.OPEN,
      version: 1,
      versionHash: input.versionHash,
      title: input.candidate.payload.title,
      payload: input.candidate.payload,
      rank: input.candidate.rank,
      questionKey: input.candidate.questionKey ?? null,
      revisedFromCardId: input.candidate.revisedFromCardId ?? null,
      openedAt: new Date(),
    } as PmAgentCard;
    this.cards.push(card);
    return { status: 'created', card };
  }
  async traceGate(
    _runId: string,
    layer: string,
    detail: Record<string, unknown>,
  ) {
    this.gateTraces.push({ layer, detail });
  }
}

/** Read-only tools that mint evidence ids, like the real belt. */
export class FakeToolbox implements PmToolbox {
  calls: { name: string; input: Record<string, any> }[] = [];
  /** Text placed inside every tool result (e.g. injection bait). */
  payloadText = 'aggregate: 41';
  evidence = new Map<string, PmEvidenceRef>();

  async definitions(names: readonly string[]): Promise<AgentToolDefinition[]> {
    return names.map((name) => ({
      name,
      description: name,
      input_schema: { type: 'object', properties: {} },
    }));
  }

  async execute(
    name: string,
    input: Record<string, any>,
    ctx: PmToolContext,
  ): Promise<PmToolOutcome> {
    this.calls.push({ name, input });
    const ref: PmEvidenceRef = {
      id: randomUUID(),
      source: name.startsWith('analytics') ? 'analytics' : 'code',
      kind: 'metric',
      label: `${name} ${ctx.lane} ${this.calls.length}`,
      fetchedAt: new Date(),
      excerpt: this.payloadText,
    };
    this.evidence.set(ref.id, ref);
    return {
      ok: true,
      evidence: [ref],
      modelResult: fence(
        'tool_data',
        { evidence_id: ref.id, source: ref.source, label: ref.label },
        this.payloadText,
        2000,
      ),
    };
  }
}

const toolUse = (
  name: string,
  input: Record<string, any>,
): AgentContentBlock => ({
  type: 'tool_use',
  id: `tu_${randomUUID().slice(0, 8)}`,
  name,
  input,
});

export const turn = (
  content: AgentContentBlock[],
  stopReason: AgentTurnResult['stopReason'] = 'tool_use',
): AgentTurnResult => ({
  content,
  stopReason,
  usage: { inputTokens: 1000, outputTokens: 300 },
});

export const submitTurn = (candidates: unknown[]) =>
  turn([toolUse(PM_SUBMIT_TOOL, { candidates })]);

export const callTool = (name: string, input: Record<string, any> = {}) =>
  turn([toolUse(name, input)]);

export const verdictTurn = (verdicts: unknown[]) =>
  turn([toolUse(PM_CRITIC_SUBMIT_TOOL, { verdicts })]);

/** Evidence ids that tool results in the conversation so far carried. */
export function evidenceIdsIn(request: PmLlmStepRequest): string[] {
  const text = JSON.stringify(request.messages);
  return [...text.matchAll(/evidence_id=\\"([0-9a-f-]{36})\\"/g)].map(
    (m) => m[1],
  );
}

export type Script = (
  request: PmLlmStepRequest,
  callIndex: number,
) => AgentTurnResult | 'fail';

/**
 * A scripted model behind the real ledger rules: each step reserves its estimated maximum
 * first (no reservation → `budget`, nothing "billed"), then settles a fixed small cost.
 */
export class FakeLlm implements PmLlmPort {
  calls: PmLlmStepRequest[] = [];
  targets: { taskId: string; cheap: boolean }[] = [];
  costPerCall = 0.001;

  constructor(private readonly script: Script) {}

  async resolveTarget(
    taskId: string,
    _promptCode: string,
    cheap: boolean,
  ): Promise<PmLlmTarget> {
    this.targets.push({ taskId, cheap });
    return { provider: 'openai', model: cheap ? 'gpt-4o-mini' : 'gpt-5-mini' };
  }

  async loadPrompt() {
    return { text: 'system prompt', version: 3 };
  }

  async step(request: PmLlmStepRequest): Promise<PmLlmStepResult> {
    const max = estimateCallMaxUsd(
      request.target.model,
      JSON.stringify(request.messages).length,
      request.maxTokens,
    );
    const reservation = request.ledger.reserve(
      request.kind === 'critic' ? 'critic' : 'lane',
      request.lane,
      max,
    );
    if (!reservation) return { status: 'budget' };
    this.calls.push(request);
    const result = this.script(request, this.calls.length - 1);
    if (result === 'fail') {
      request.ledger.release(reservation);
      return { status: 'failed', error: 'provider down' };
    }
    request.ledger.settle(reservation, this.costPerCall);
    return {
      status: 'ok',
      turn: result,
      provider: 'openai',
      model: request.target.model,
      costUsd: this.costPerCall,
    };
  }
}

/** A lane script: research once, then submit `make(evidenceIds, lane)`. Critic passes all. */
export function researchThenSubmit(
  make: (evidenceIds: string[], lane: string) => unknown[],
  criticPass = true,
): Script {
  return (request) => {
    if (request.kind === 'critic') {
      const count = Number(
        /Review these (\d+) candidates/.exec(
          String(request.messages[0].content),
        )?.[1] ?? 0,
      );
      return verdictTurn(
        Array.from({ length: count }, (_, index) => ({
          index,
          pass: criticPass,
          reasons: criticPass ? [] : ['grounded'],
        })),
      );
    }
    const ids = evidenceIdsIn(request);
    if (!ids.length) {
      const tool =
        request.tools.find((t) => t.name !== PM_SUBMIT_TOOL)?.name ??
        PM_SUBMIT_TOOL;
      return callTool(tool, {});
    }
    return submitTurn(make(ids, request.lane));
  };
}

export const recCandidate = (
  index: number,
  ids: string[],
  category: PmCardCategory = PmCardCategory.PRODUCT,
  over: Record<string, any> = {},
) => ({
  kind: PmCardKind.RECOMMENDATION,
  category,
  recommendation: recFor(index, ids, over),
});
