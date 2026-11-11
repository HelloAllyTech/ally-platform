import type { WaBotSettings, WaHandledBy, WaOrgSettings } from "./whatsappBot";

export enum ChatbotStatus {
  DRAFT = "draft",
  LIVE = "live",
  PAUSED = "paused",
}

/** Who may chat with a bot. */
export enum ChatbotAccessMode {
  ANYONE = "anyone",
  RECOGNISED = "recognised",
  LISTED = "listed",
}

export enum ChatbotAnswerMode {
  DOCUMENTS_ONLY = "documents_only",
  DOCUMENTS_AND_GENERAL = "documents_and_general",
}

export enum ChatbotKnowledgeSource {
  SELECTED = "selected",
  /** The asker's organisation's documents plus shared ones (the platform number). */
  ORGANISATION = "organisation",
}

export enum ChatbotMemberRole {
  VIEWER = "viewer",
  EDITOR = "editor",
  OWNER = "owner",
}

export interface ChatbotPersona {
  displayName?: string;
  systemPrompt?: string;
  tone?: string;
  greeting?: string;
  defaultLanguage?: string;
}

export interface ChatbotModelChoice {
  provider: string;
  model: string;
  temperature?: number | null;
}

export interface ConnectorSummary {
  address: string | null;
  status: string;
  lastError: string | null;
  lastInboundAt: string | null;
  details: Record<string, unknown>;
}

export interface Connector {
  id: string;
  type: string;
  typeLabel: string;
  name: string;
  chatbotId: string | null;
  chatbotName: string | null;
  summary: ConnectorSummary | null;
  createdAt: string;
}

export interface ChatbotStats {
  messages: number;
  people: number;
  answered: number;
  declined: number;
  openUnanswered: number;
  lastMessageAt: string | null;
}

/** Which engine answers chatbots (Agents v2): v2, or v1 while the agent is off in Defaults. */
export type ChatbotRuntime = "v1" | "v2";

/** The engine that answered one Preview test; `v2_fallback` means v2 failed and v1 answered. */
export type ChatbotRuntimeUsed = "v1" | "v2" | "v2_fallback";

/** One step the new engine took, in order. */
export interface AgentTraceStep {
  node: string;
  ms: number;
  summary: string;
}

/** What the conversational agent understood a message to be (ally-be `AgentTurnType`). */
export type AgentTurnType = "smalltalk" | "about_bot" | "question" | "unclear";

export interface Chatbot {
  id: string;
  name: string;
  description: string | null;
  status: ChatbotStatus;
  accessMode: ChatbotAccessMode;
  answerMode: ChatbotAnswerMode;
  knowledgeSource: ChatbotKnowledgeSource;
  persona: ChatbotPersona;
  model: ChatbotModelChoice | null;
  /** What actually answers: v2, or v1 (the backup engine) while the agent is off in Defaults. */
  effectiveRuntime: ChatbotRuntime;
  myRole: ChatbotMemberRole;
  connectors: Connector[];
  documentCount: number;
  /** Documents it can answer from now: indexed and not archived. */
  readyDocumentCount: number;
  audienceCount: number;
  memberCount: number;
  stats: ChatbotStats;
  /** When it was last tried in Preview. */
  lastTestedAt: string | null;
  /** The caller's own unfinished onboarding for this bot (chunk 20a), if any. */
  setupDraftId?: string | null;
  /** When it was removed: an archived assistant is read-only. */
  archivedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GetChatbotsResponse {
  chatbots: Chatbot[];
  /** Platform admins create bots; everyone else works on the bots they were added to. */
  canCreate: boolean;
}

export interface UpdateChatbotRequest {
  id: string;
  name?: string;
  description?: string | null;
  persona?: ChatbotPersona;
  answerMode?: ChatbotAnswerMode;
  accessMode?: ChatbotAccessMode;
  knowledgeSource?: ChatbotKnowledgeSource;
  model?: ChatbotModelChoice | null;
}

export interface ChatbotDocumentRow {
  id: string;
  title: string;
  status: string;
  isGlobal: boolean;
  archived: boolean;
  /** True when the document belongs to this chatbot only (uploaded on its Knowledge tab). */
  private: boolean;
  updatedAt: string;
}

/** One document attached to a chatbot, with its text: what the Knowledge tab's View panel shows. */
export interface ChatbotDocumentDetail {
  id: string;
  title: string;
  status: string;
  private: boolean;
  archived: boolean;
  sourceType: string;
  fileName: string | null;
  /** Why it failed, when it did. */
  statusMessage: string | null;
  updatedAt: string;
  rawText: string;
}

/** Edit one of a chatbot's own documents. A changed `text` retrains the chatbot on it. */
export interface UpdateChatbotDocumentRequest {
  id: string;
  documentId: string;
  title?: string;
  text?: string;
}

/** A file to upload as one of a chatbot's own documents. */
export interface CreateChatbotUploadUrlRequest {
  id: string;
  fileName: string;
  fileSize: number;
  contentType: string;
}

/**
 * A document private to one chatbot: created, attached and queued for indexing in one call.
 * Files carry what the presigned upload returned; pasted text carries `text`.
 */
export interface CreatePrivateChatbotDocumentRequest {
  id: string;
  title: string;
  sourceType: "pdf" | "docx" | "epub" | "paste" | "url";
  fileUrl?: string;
  fileName?: string;
  contentType?: string;
  sizeBytes?: number;
  text?: string;
  sourceUrl?: string;
}

/** A bot's changes to the defaults (same shape organisations used to have). */
export type ChatbotSettingsOverride = WaOrgSettings;

export interface ChatbotSettingsView {
  chatbotId: string;
  defaults: WaBotSettings;
  overrides: ChatbotSettingsOverride;
  effective: WaBotSettings;
}

export interface ChatbotTestTurn {
  role: "user" | "assistant";
  content: string;
}

export interface ChatbotDraft {
  persona?: ChatbotPersona;
  answerMode?: ChatbotAnswerMode;
  model?: ChatbotModelChoice | null;
  documentIds?: string[];
  settings?: ChatbotSettingsOverride;
}

export interface TestChatbotRequest {
  id: string;
  message: string;
  history?: ChatbotTestTurn[];
  draft?: ChatbotDraft;
  asTenantId?: string;
  checkAccess?: boolean;
  /** The Preview thread (`preview-<uuid>`), kept until "New thread". */
  conversationId?: string;
}

/** What a streamed Preview reply is doing now (ally-be relays ally-ai's codes). */
export type ChatbotTestStatusCode =
  | "thinking"
  | "searching"
  | "found"
  | "checking"
  | "rewriting"
  | "writing";

export interface ChatbotTestStatus {
  code: ChatbotTestStatusCode;
  label: string;
  /** The search query, "3 passages", or why a draft went back (a rejection code). */
  detail?: string;
  /** Where found passages came from: document titles, at most 3. */
  documents?: string[];
}

export interface TestChatbotResponse {
  reply: string;
  handledBy: WaHandledBy;
  citations: {
    passage_number: number;
    document_title: string;
    page_from: number;
    section_path: string;
  }[];
  retrieval: Record<string, unknown> | null;
  language: string | null;
  wouldFileUnanswered: { reason: string } | null;
  wouldAlert: string | null;
  latencyMs: number;
  usedDraft: boolean;
  runtime: ChatbotRuntimeUsed;
  runId: string | null;
  trace: AgentTraceStep[] | null;
  /** Why the new engine failed, when v1 answered instead. */
  fallbackReason: string | null;
  /** False while the new engine is turned off in Defaults. */
  runtimeAllowed: boolean;
  conversationId: string;
  /** Agent mode: what the agent understood the message to be. */
  turnType?: AgentTurnType | null;
}
