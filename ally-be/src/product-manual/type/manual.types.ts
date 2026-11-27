import type {
  ManualAuthorKind,
  ManualSourceRef,
} from '../entity/manual-revision.entity';
import type {
  ManualPage,
  ManualPageKind,
  ManualReleaseState,
} from '../entity/manual-page.entity';
import type { ManualRevision } from '../entity/manual-revision.entity';
import type { ManualRunItemOutcome } from '../entity/manual-run.entity';
import type { ManualLastRun } from '../entity/manual-settings.entity';
import type {
  ManualProposalKind,
  ManualProposalSource,
  ManualProposalStatus,
} from '../entity/manual-proposal.entity';

export type {
  ManualAuthorKind,
  ManualSourceRef,
  ManualPage,
  ManualPageKind,
  ManualReleaseState,
  ManualRevision,
  ManualLastRun,
  ManualProposalKind,
  ManualProposalSource,
  ManualProposalStatus,
};

/** Who is making a write, and why (the `reason` is shown verbatim in the change log). */
export type ManualAuthor = {
  kind: ManualAuthorKind;
  ref?: string | null;
  reason: string;
  sourceRefs?: ManualSourceRef[];
  /** Set by `revert`: the revision this write copies. */
  revertOf?: string | null;
};

export type ManualWriteInput = {
  slug: string;
  title?: string;
  summary?: string;
  body?: string;
  parentSlug?: string | null;
  position?: number;
  kind?: ManualPageKind;
  roles?: string[];
  surfaces?: string[];
  journeys?: string[];
};

export type ManualWriteErrorCode =
  | 'invalid_slug'
  | 'scrubbed'
  | 'not_found'
  | 'too_large'
  | 'invalid';

/** Thrown by `ManualPageService.write`; the message is safe to show a model or a person. */
export class ManualWriteError extends Error {
  constructor(
    public readonly code: ManualWriteErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ManualWriteError';
  }
}

export type ManualWriteResult = {
  page: ManualPage;
  revision: ManualRevision | null;
  changed: boolean;
  created: boolean;
};

// ── API shapes (docs/product-manual.md) ─────────────────────────────────────

export type PageRow = {
  slug: string;
  title: string;
  summary: string;
  parentSlug: string | null;
  position: number;
  kind: ManualPageKind;
  roles: string[];
  surfaces: string[];
  journeys: string[];
  releaseState: ManualReleaseState;
  verifiedAt: string | null;
  updatedAt: string;
};

export type ChangeRow = {
  id: string;
  slug: string;
  pageTitle: string;
  at: string;
  authorKind: ManualAuthorKind;
  authorLabel: string;
  reason: string;
  revertOf: string | null;
};

export type PageDetail = PageRow & {
  body: string;
  verifiedRef: string | null;
  backlinks: { slug: string; title: string }[];
  outlinks: { slug: string; title: string }[];
  /** Ancestors, top-level first, not including the page itself. */
  breadcrumb: { slug: string; title: string }[];
  children: { slug: string; title: string; summary: string }[];
  lastChange: ChangeRow | null;
};

export type SearchHit = {
  slug: string;
  title: string;
  parentTitle: string | null;
  /** HTML; every character is escaped except the `<mark>` tags. */
  snippet: string;
  rank: number;
};

export type GraphNode = {
  slug: string;
  title: string;
  parentSlug: string | null;
  kind: ManualPageKind;
};

export type ManualGraph = {
  nodes: GraphNode[];
  edges: { from: string; to: string }[];
};

export type ManualAgentState =
  | 'disabled'
  | 'idle'
  | 'running'
  | 'budget_exhausted';

export type ManualState = {
  agentState: ManualAgentState;
  banner: string | null;
  budget: { monthlyBudgetUsd: number; spentUsd: number; reservedUsd: number };
  lastRun: ManualLastRun | null;
  nextRunAt: string | null;
  openProposals: number;
  openGaps: number;
  analyticsAvailable: boolean;
  canAdminister: boolean;
};

/** What `ManualSettingsService` returns: the singleton row with numbers as numbers. */
export type ManualSettingsView = {
  enabled: boolean;
  monthlyBudgetUsd: number;
  lastRunDate: string | null;
  lastRun: ManualLastRun | null;
  updatedBy: number | null;
  updatedAt: string;
};
export type ManualBudgetSnapshot = {
  monthlyBudgetUsd: number;
  spentUsd: number;
  reservedUsd: number;
  exhausted: boolean;
  approximate: boolean;
};

export type RunRow = {
  id: string;
  trigger: 'scheduled' | 'manual';
  status: string;
  stopReason: string | null;
  reservedUsd: number;
  spentUsd: number;
  pagesTouched: number;
  proposalsApplied: number;
  summary: string | null;
  error: string | null;
  triggeredBy: number | null;
  /** One line per work item: what came of it, and how the model loop ended. */
  itemLog: ManualRunItemOutcome[];
  startedAt: string;
  finishedAt: string | null;
};

export type ProposalView = {
  id: string;
  kind: ManualProposalKind;
  pageSlug: string | null;
  summary: string;
  detail: string;
  prRef: string | null;
  source: ManualProposalSource;
  submittedBy: number | null;
  status: ManualProposalStatus;
  appliedRevisionId: string | null;
  resolvedAt: string | null;
  createdAt: string;
};

export type ImportPage = {
  slug: string;
  title: string;
  summary?: string;
  parentSlug?: string | null;
  position?: number;
  kind?: ManualPageKind;
  body?: string;
  roles?: string[];
  surfaces?: string[];
  journeys?: string[];
};

export type ImportResult = {
  created: number;
  updated: number;
  unchanged: number;
  errors: string[];
};
