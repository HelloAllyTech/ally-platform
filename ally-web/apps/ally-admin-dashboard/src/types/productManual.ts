/**
 * Roadmap → Product Manual: the shapes `ally-be/docs/product-manual.md` promises. That contract is
 * the only coupling to the backend; where it leaves a shape open (a run, a proposal, a saved
 * conversation's messages) the fields here are optional and read defensively.
 */

export type ManualPageKind = "section" | "page";
export type ManualReleaseState = "live" | "next";

export interface ManualPageRef {
  slug: string;
  title: string;
}

export interface ManualPageRow {
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
}

export interface ManualChangeRow {
  /** The revision id. */
  id: string;
  slug: string;
  pageTitle: string;
  at: string;
  authorKind: string;
  authorLabel: string;
  reason: string | null;
  revertOf: string | null;
}

export interface ManualPageDetail extends ManualPageRow {
  body: string;
  verifiedRef: string | null;
  backlinks: ManualPageRef[];
  outlinks: ManualPageRef[];
  breadcrumb: ManualPageRef[];
  children: (ManualPageRef & { summary: string })[];
  lastChange: ManualChangeRow | null;
}

export interface ManualSearchHit {
  slug: string;
  title: string;
  parentTitle: string | null;
  /** HTML in which only `<mark>` is allowed. Render with `parseSnippet`, never as HTML. */
  snippet: string;
  rank: number;
}

export interface ManualGraphNode {
  slug: string;
  title: string;
  parentSlug: string | null;
  kind: ManualPageKind;
}

export interface ManualGraph {
  nodes: ManualGraphNode[];
  edges: { from: string; to: string }[];
}

/** Not spelled out by the contract: every field optional. */
export interface ManualLastRun {
  id?: string;
  status?: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  at?: string | null;
  summary?: string | null;
  spentUsd?: number | null;
}

export type ManualAgentState = "disabled" | "idle" | "running" | "budget_exhausted";

export interface ManualState {
  agentState: ManualAgentState;
  banner: string | null;
  budget: { monthlyBudgetUsd: number; spentUsd: number; reservedUsd: number };
  lastRun: ManualLastRun | null;
  nextRunAt: string | null;
  openProposals: number;
  openGaps: number;
  analyticsAvailable: boolean;
  canAdminister: boolean;
}

// ── chat ──────────────────────────────────────────────────────────────────────────────────────

export interface ManualChatContext {
  pageSlug?: string;
  selection?: string;
}

export interface ManualDraftCard {
  id: string;
  title: string;
  text: string;
  relatedPages: ManualPageRef[];
  savedCode?: string | null;
  discarded?: boolean;
}

export interface ManualConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
}

/**
 * A saved message, as `GET /conversations/:id` returns it. The body is `text`. Activity lines are
 * not persisted (they exist only in the live stream), so a reopened chat shows no receipt.
 */
export interface ManualConversationMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  at: string;
  citations?: ManualPageRef[];
  edits?: { slug: string; title: string; revisionId: string; reason: string | null }[];
}

export interface ManualConversation extends ManualConversationSummary {
  createdAt: string;
  messages: ManualConversationMessage[];
  drafts: ManualDraftCard[];
}

export interface ManualSaveDraftRequest {
  conversationId: string;
  draftId: string;
  text?: string;
  title?: string;
}

// ── admin ─────────────────────────────────────────────────────────────────────────────────────

export interface ManualAdminSettings {
  enabled: boolean;
  monthlyBudgetUsd: number;
  [key: string]: unknown;
}

/** One page in an import file; the same shape `POST /admin/import` takes. */
export interface ManualImportPage {
  slug: string;
  title: string;
  summary?: string;
  parentSlug?: string | null;
  position?: number;
  kind?: "section" | "page";
  body?: string;
  roles?: string[];
  surfaces?: string[];
  journeys?: string[];
}

export interface ManualImportResult {
  created: number;
  updated: number;
  unchanged: number;
  errors: string[];
}

export interface ManualRun {
  id: string;
  status?: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  spentUsd?: number | null;
  summary?: string | null;
}

export interface ManualProposal {
  id: string;
  kind?: string;
  pageSlug?: string | null;
  summary: string;
  detail?: string | null;
  prRef?: string | null;
  status?: string;
  createdAt?: string;
}

export interface ManualAgentKey {
  id: string;
  label: string;
  keyPrefix: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}
