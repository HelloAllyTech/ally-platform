// ── Chat Message ────────────────────────────────────────────────

export enum ChatMessageRole {
  USER = 'user',
  ASSISTANT = 'assistant',
}

/** Matches the BE chat history response schema */
export interface AskAIChatMessage {
  id: string;
  role: ChatMessageRole;
  content: string;
  createdAt: string;
  updatedAt: string;
  /** Frontend-only: true while the AI response is being streamed */
  isStreaming?: boolean;
}

// ── SSE Events ──────────────────────────────────────────────────

export enum SSEEventType {
  TOKEN = 'token',
  DONE = 'done',
  ERROR = 'error',
}

export interface SSETokenEvent {
  type: SSEEventType.TOKEN;
  content: string;
}

export interface SSEDoneEvent {
  type: SSEEventType.DONE;
}

export interface SSEErrorEvent {
  type: SSEEventType.ERROR;
  error: string;
}

export type SSEEvent = SSETokenEvent | SSEDoneEvent | SSEErrorEvent;

// ── Hook Props ──────────────────────────────────────────────────

export interface UseAskAIChatOptions {
  scenarioSessionId?: string;
}
