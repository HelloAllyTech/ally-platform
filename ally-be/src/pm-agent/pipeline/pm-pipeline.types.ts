import { AgentToolDefinition } from 'src/llm-agent/type/agent-llm.type';
import { PmAgentCard } from '../entity/pm-agent-card.entity';
import { PmAgentMemory } from '../entity/pm-agent-memory.entity';
import { PmAgentRun } from '../entity/pm-agent-run.entity';
import { PmAgentSettings } from '../entity/pm-agent-settings.entity';
import {
  PmCardCategory,
  PmCardKind,
  PmCardStatus,
  PmLane,
  PmRunTrigger,
} from '../enum/pm-agent.enum';

/** One evidence item as the pipeline knows it (the row's snapshot stays in the DB). */
export interface PmEvidenceRef {
  id: string;
  source: string;
  kind: string;
  label: string;
  fetchedAt: Date;
  /** Short excerpt for the critic; internal, never in a compiled PRD. */
  excerpt: string;
}

export interface PmEvidenceDraft {
  source: string;
  kind: string;
  label: string;
  query?: Record<string, unknown> | null;
  snapshot: unknown;
  url?: string | null;
}

/** What one tool call hands back to the lane runner. */
export interface PmToolOutcome {
  /** Fenced, bounded text the model reads. */
  modelResult: string;
  /** Evidence items this call created (citable for the rest of the run). */
  evidence: PmEvidenceRef[];
  ok: boolean;
}

export interface PmToolContext {
  runId: string;
  lane: PmLane;
}

/** The lanes' read-only tool belt. No tool here writes anything except evidence rows. */
export interface PmToolbox {
  definitions(names: readonly string[]): Promise<AgentToolDefinition[]>;
  execute(
    name: string,
    input: Record<string, any>,
    ctx: PmToolContext,
  ): Promise<PmToolOutcome>;
}

/** A candidate card that passed lane-level schema validation. Nothing here is persisted yet. */
export interface PmCandidate {
  lane: PmLane;
  kind: PmCardKind;
  category: PmCardCategory;
  payload: Record<string, any>;
  /** Questions: the stable key for skip suppression and the answer fact. */
  questionKey?: string | null;
  /** Revisions: the card the feedback was on, and the feedback row. */
  revisedFromCardId?: string | null;
  feedbackId?: string | null;
  /** Set on a question the critic spawned for a recommendation blocked on missing knowledge. */
  unblocks?: boolean;
}

export interface PmRankedCandidate extends PmCandidate {
  rank: number;
  evidenceFreshness: Date | null;
}

/** One thing a candidate must not duplicate (dedupe corpus). */
export interface PmDedupeItem {
  type: 'card' | 'opportunity' | 'finding';
  id: string;
  label: string;
  text: string;
  status?: PmCardStatus | string;
  kind?: PmCardKind;
  questionKey?: string | null;
  /** Rejected cards: `source|label` of the evidence they cited, for the new-evidence rule. */
  evidenceKeys?: string[];
}

/** A decided card with an outcome, for exemplars and lane stats. */
export interface PmOutcomeRow {
  cardId: string;
  category: string;
  lane: string | null;
  kind: string;
  decision: string;
  decidedAt: Date;
  merged: boolean;
  released: boolean;
  buildFailed: boolean;
  reverted: boolean;
  title: string;
  payload: Record<string, any>;
  reason: string | null;
  reasonChip: string | null;
}

export interface PmFeedbackTask {
  id: string;
  cardId: string;
  text: string;
  chips: string[];
  reviseNow: boolean;
  createdAt: Date;
  card: PmAgentCard | null;
}

export interface PmPersistInput {
  runId: string;
  candidate: PmRankedCandidate;
  versionHash: string;
  queueCap: number;
}

export type PmPersistResult =
  | { status: 'created'; card: PmAgentCard }
  | { status: 'duplicate' }
  | { status: 'queue_full' };

/**
 * Every read and write the pipeline makes, behind one seam. The real implementation is
 * PmAgentPipelineStore (repositories + SQL); tests use an in-memory fake. `persistCard` is the
 * ONLY place a card is created.
 */
export interface PmPipelineStore {
  getSettings(): Promise<PmAgentSettings>;
  countOpen(): Promise<number>;
  findRunning(): Promise<PmAgentRun | null>;
  /** Insert a `running` row; null when another run holds the one-running index. */
  startRun(input: {
    trigger: PmRunTrigger;
    triggeredBy: number | null;
    reservedUsd: number;
    runDate: string;
  }): Promise<PmAgentRun | null>;
  recordSkippedRun(input: {
    trigger: PmRunTrigger;
    triggeredBy: number | null;
    stopReason: string;
    runDate: string;
  }): Promise<string>;
  finishRun(
    id: string,
    patch: Partial<
      Pick<
        PmAgentRun,
        | 'status'
        | 'stopReason'
        | 'finishedAt'
        | 'spentUsd'
        | 'reservedUsd'
        | 'cardsCreated'
        | 'lanes'
        | 'error'
      >
    >,
  ): Promise<void>;
  updateRunSpend(id: string, spentUsd: number): Promise<void>;
  failStaleRuns(olderThanMs: number): Promise<number>;
  hasRunFor(runDate: string, trigger: PmRunTrigger): Promise<boolean>;
  /** Lanes selected by the most recent runs, newest first. */
  recentRunLanes(limit: number): Promise<string[][]>;
  /** Month spend + open reservations, for the run cap. */
  monthCommittedUsd(now: Date): Promise<number>;
  pendingFeedback(limit: number, onlyId?: string): Promise<PmFeedbackTask[]>;
  /** Conditional status move; false when the row was not in `from`. */
  moveFeedback(
    id: string,
    from: string[],
    to: string,
    successorCardId?: string | null,
  ): Promise<boolean>;
  dedupeCorpus(): Promise<PmDedupeItem[]>;
  isQuestionSuppressed(questionKey: string): Promise<boolean>;
  activeMemory(): Promise<PmAgentMemory[]>;
  outcomeRows(lookbackDays: number): Promise<PmOutcomeRow[]>;
  saveLearnedScores(
    rows: { dimension: 'category' | 'lane'; key: string; score: number }[],
  ): Promise<void>;
  bumpShown(category: string, lane: string): Promise<void>;
  tenantNames(): Promise<string[]>;
  hasUxSignals(): Promise<boolean>;
  persistCard(input: PmPersistInput): Promise<PmPersistResult>;
  /** One `gate` trace row per layer (cost 0): what passed, what failed and why. */
  traceGate(
    runId: string,
    layer: string,
    detail: Record<string, unknown>,
  ): Promise<void>;
}

/** The stable context every lane shares (cached prompt prefix). */
export interface PmSharedContext {
  mandate: string;
  strategy: string;
  productMap: string;
}

export interface PmContextSource {
  sharedContext(settings: PmAgentSettings): Promise<PmSharedContext>;
}
