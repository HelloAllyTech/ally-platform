// ── Citation ────────────────────────────────────────────────────

export interface Citation {
  timestamp: string;
  content: string;
  /** -1 = Client, positive = Counselor */
  senderId: number;
  transcriptId: number;
}

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
  citations?: Citation[];
  /** Frontend-only: true while the AI response is being streamed */
  isStreaming?: boolean;
}

// ── SSE Events ──────────────────────────────────────────────────

export enum SSEEventType {
  START = 'start',
  TOKEN = 'token',
  CITATIONS = 'citations',
  DONE = 'done',
  ERROR = 'error',
}

export interface SSEStartEvent {
  type: SSEEventType.START;
}

export interface SSETokenEvent {
  type: SSEEventType.TOKEN;
  content: string;
}

export interface SSECitationsEvent {
  type: SSEEventType.CITATIONS;
  citations: Citation[];
}

export interface SSEDoneEvent {
  type: SSEEventType.DONE;
  content?: string;
  citations?: Citation[];
}

export interface SSEErrorEvent {
  type: SSEEventType.ERROR;
  error: string;
}

export type SSEEvent =
  | SSEStartEvent
  | SSETokenEvent
  | SSECitationsEvent
  | SSEDoneEvent
  | SSEErrorEvent;

// ── Hook Props ──────────────────────────────────────────────────

export interface UseAskAIChatOptions {
  scenarioSessionId?: string;
}
