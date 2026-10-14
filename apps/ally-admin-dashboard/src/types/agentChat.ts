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
