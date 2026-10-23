import type { CourseCopilotSuggestedAction, CourseReviewFinding } from "./courseCopilot";

/**
 * The chat contract the admin console's agents share, rendered by `components/agent-chat/`.
 *
 * Builder, Course Copilot and the character interview each mirror their own backend's SSE types
 * (`BuilderQuestionEvent`, `CourseCopilotQuestionEvent`, `CharacterInterviewQuestionEvent`, …);
 * those are structurally assignable to these, which is what lets one set of chat components
 * render all three.
 */
export type AgentQuestionKind = "freeText" | "singleSelect" | "multiSelect" | "dropdown";

export interface AgentQuestionOption {
  id: string;
  label: string;
  /** The trade-off in one line — what makes an option pickable at a glance. */
  description?: string;
  /** At most one per question; sorted first, marked, and focused for one-key answering. */
  recommended?: boolean;
}

export interface AgentQuestionEvent {
  id: string;
  prompt: string;
  kind: AgentQuestionKind;
  options?: AgentQuestionOption[];
  /** Show an "add your own" entry alongside the options. */
  allowCustom?: boolean;
  /** Offer a "None of these" answer. */
  allowNone?: boolean;
  minSelections?: number;
  maxSelections?: number;
  /** Why this is being asked now; rendered as a subtitle on the card. */
  rationale?: string;
}

/** Structured answer posted back with the next turn for select and dropdown cards. */
export interface AgentStructuredAnswer {
  selectedOptionIds?: string[];
  customValues?: string[];
  none?: boolean;
}

/**
 * What one agent turn read, searched, changed and failed at — composed by the server from what
 * actually happened, so every string is ready to display. Mirrors ally-be's `AgentTurnReceipt`
 * (`src/llm-agent/runtime`), which Course Copilot and the character interview send; Builder's own
 * `BuilderTurnReceipt` adds the PRD version. Agent-adjacent JSON: read it through
 * `normalizeAgentReceipt`.
 */
export interface AgentTurnReceipt {
  /** Things read by name: `Guidance: Progressive Disclosure…`, `Item "Warm-up quiz"`. */
  read: string[];
  /** Lookups with what came back: `Library search "listening" (roleplay) — 3 matches`. */
  searched: string[];
  /** What the turn changed: `Brief: audience, outcomes`, `Course: Renamed section 2`. */
  changed: string[];
  /** Lookups and changes that failed: `Publish the course — Not ready to publish yet`. */
  failed: string[];
  /** Problems the reply was delivered with anyway. */
  warnings: string[];
  /** The agent's stated reason the person's own words changed nothing. */
  unchangedBecause?: string;
}

/** Course Copilot's and the character interview's validated-turn switches (Settings → AI models). */
export interface ValidatedAgentTurnsSettings {
  courseCopilot: boolean;
  characterInterview: boolean;
}

/** One rendered row in an agent chat feed. */
export interface AgentChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** Tool activity for this turn, shown as small notes above the bubble. */
  toolNotes?: string[];
  question?: AgentQuestionEvent;
  /** Set on resume so an answered freeText/singleSelect card renders locked. */
  answeredWith?: string;
  /** Set on resume so an answered multi-select/dropdown card renders locked. */
  answeredAnswer?: AgentStructuredAnswer;
  /** Tokens are still arriving for this row. */
  isStreaming?: boolean;
  /** The admin stopped the turn; any partial text is kept. */
  interrupted?: boolean;
  error?: string;
  /**
   * `error` is transient, so the row offers Retry (re-sends the last user turn). Absent for errors
   * a retry cannot fix.
   */
  retryable?: boolean;
  /** A reviewer's findings, listed with an action chip where one applies. Course Copilot only. */
  reviewFindings?: CourseReviewFinding[];
  /** Chips under the row; clicking one sends its message. Course Copilot only. */
  suggestedActions?: CourseCopilotSuggestedAction[];
}
