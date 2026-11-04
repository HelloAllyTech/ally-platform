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

export enum ChatbotAudienceKind {
  USER = "user",
  ORGANISATION = "organisation",
  PHONE = "phone",
  EMAIL = "email",
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

export interface ConnectorType {
  type: string;
  label: string;
  description: string;
}

export interface ChatbotStats {
  messages: number;
  people: number;
  answered: number;
  declined: number;
  openUnanswered: number;
  lastMessageAt: string | null;
}

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
  myRole: ChatbotMemberRole;
  connectors: Connector[];
  documentCount: number;
  audienceCount: number;
  memberCount: number;
  stats: ChatbotStats;
  /** When it was last tried in Preview. */
  lastTestedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GetChatbotsResponse {
  chatbots: Chatbot[];
  /** Platform admins create bots; everyone else works on the bots they were added to. */
  canCreate: boolean;
}

export interface CreateChatbotRequest {
  name: string;
  description?: string;
  persona?: ChatbotPersona;
  answerMode?: ChatbotAnswerMode;
  accessMode?: ChatbotAccessMode;
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
  updatedAt: string;
}

export interface ChatbotMember {
  userId: number;
  name: string | null;
  email: string | null;
  role: ChatbotMemberRole;
}

export interface ChatbotAudienceEntry {
  id: string;
  kind: ChatbotAudienceKind;
  value: string;
  label: string | null;
  createdAt: string;
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
}
