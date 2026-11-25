import {
  RoleplayDesignMode,
  RoleplayModeSettings,
} from 'src/learn/util/roleplay-design.util';
import { AgentTurnReceipt } from 'src/llm-agent/runtime/agent-turn.types';

/**
 * The roleplay interview: Studio's Agent Builder Copilot as a chat. The agent
 * interviews a trainer, fills a brief, proposes a plan, and on approval hands
 * the existing frontend generation pipeline its inputs. It builds nothing
 * itself and keeps no engine of its own — the roleplay it leads to is a normal
 * Studio roleplay.
 */

export enum RoleplayInterviewStatus {
  INTERVIEWING = 'INTERVIEWING',
  PLAN_READY = 'PLAN_READY',
  APPROVED = 'APPROVED',
  ABANDONED = 'ABANDONED',
}

export enum RoleplayInterviewMessageRole {
  USER = 'user',
  ASSISTANT = 'assistant',
}

export type RoleplayInterviewDifficulty = 'EASY' | 'MEDIUM' | 'HARD';

export const ROLEPLAY_INTERVIEW_DIFFICULTIES: readonly RoleplayInterviewDifficulty[] =
  ['EASY', 'MEDIUM', 'HARD'];

export interface RoleplayInterviewLanguage {
  languageId: string;
  label: string;
  code: string;
}

/**
 * What the interview has settled. The names (competencyNames,
 * learnerProfileName, client.characterName) and language labels are set by
 * the server from the library, never taken from the model.
 */
export interface RoleplayInterviewBrief {
  learners?: { who: string; priorExperience?: string };
  learnerProfileId?: string;
  learnerProfileName?: string;
  goal?: string;
  competencyIds?: string[];
  competencyNames?: string[];
  mode?: RoleplayDesignMode;
  difficulty?: RoleplayInterviewDifficulty;
  client?: {
    description?: string;
    characterId?: string;
    characterName?: string;
  };
  /**
   * How the client was chosen, kept by the server (never from the model's update_brief): the
   * Character Library was searched, how many characters could play the client, and whether the
   * trainer chose one of them or a new character. A plan with no library character needs a
   * search, and when the search found any, the trainer's choice of a new one.
   */
  characterChoice?: {
    searched: boolean;
    matches: number;
    decision?: 'library' | 'new';
  };
  /** The library character made from this roleplay's new character, once it was saved. */
  savedCharacter?: { id: string; name: string };
  setting?: string;
  languages?: RoleplayInterviewLanguage[];
  behaviours?: { helpful: string[]; unhelpful: string[] };
  triggerWarningIds?: string[];
  minScore?: number;
  lengthMinutes?: number;
  notes?: string[];
}

export interface RoleplayInterviewCharacterSheet {
  name: string;
  summary: string;
  hides: string;
  opensUpWhen: string;
  speaks: string;
}

export interface RoleplayInterviewPlanState {
  name: string;
  guidelines: string;
}

export interface RoleplayInterviewPlan {
  version: number;
  title: string;
  characterSheet: RoleplayInterviewCharacterSheet;
  /** 2-5 moments the character must create so the learner can practise. */
  moments: string[];
  /** 3-5, most guarded first. Score bands are laid out later (stateDesignForMode). */
  states: RoleplayInterviewPlanState[];
  passCriteria: { helpful: string[]; unhelpful: string[]; minScore: number };
  openingLine: string;
  /** Derived server-side from the brief's mode (roleplaySettingsForMode). */
  supports: RoleplayModeSettings;
}

export interface RoleplayInterviewSessionView {
  id: string;
  status: RoleplayInterviewStatus;
  brief: RoleplayInterviewBrief;
  stillNeeded: string[];
  plan: RoleplayInterviewPlan | null;
  planVersion: number;
  scenarioId: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RoleplayInterviewMessageView {
  seq: number;
  role: RoleplayInterviewMessageRole;
  content: string | null;
  questions?: RoleplayInterviewQuestion[];
  receipt?: AgentTurnReceipt;
  plan?: RoleplayInterviewPlan;
  error?: string;
}

/** What approval hands the frontend's existing generation pipeline. */
export interface RoleplayInterviewGeneration {
  actorDescription: string;
  competencyId: string;
  competencyIds: string[];
  competencyName: string;
  mode: RoleplayDesignMode;
  difficulty?: string;
  characterId?: string;
  languages?: RoleplayInterviewLanguage[];
  agentTestCases: string;
  minScore?: number;
  lengthMinutes?: number;
  triggerWarningIds?: string[];
  states: RoleplayInterviewPlanState[];
}

// ── Question cards: Course Copilot's shape, so the web renders one QuestionCard ──

export type RoleplayInterviewQuestionKind =
  | 'freeText'
  | 'singleSelect'
  | 'multiSelect'
  | 'dropdown';

export interface RoleplayInterviewQuestionOption {
  id: string;
  label: string;
  description?: string;
  /** At most one option carries this. */
  recommended?: boolean;
  /** What picking this option records in the question's brief field (an id, a mode, a number). */
  value?: string;
}

/** The brief fields a question can fill by itself when the trainer picks an option. */
export const QUESTION_BRIEF_FIELDS = [
  'mode',
  'difficulty',
  'competencyIds',
  'learnerProfileId',
  'characterId',
  'languageIds',
  'minScore',
  'lengthMinutes',
] as const;
export type QuestionBriefField = (typeof QUESTION_BRIEF_FIELDS)[number];

export interface RoleplayInterviewQuestion {
  id: string;
  prompt: string;
  kind: RoleplayInterviewQuestionKind;
  options?: RoleplayInterviewQuestionOption[];
  allowCustom?: boolean;
  allowNone?: boolean;
  minSelections?: number;
  maxSelections?: number;
  rationale?: string;
  /** The brief field this question fills: a pick is recorded by the server, not left to the model. */
  field?: QuestionBriefField;
}

/**
 * SSE contract for POST /v1/learn/roleplay-interview/sessions/:id/messages/stream.
 *
 * From the shared validated runner: `tool_call {name, input}`, `tool_result
 * {name, summary, ok?, error?, message?, errors?}`, `token {delta}` (the
 * delivered reply, once, after it was checked), `question` (a card, after the
 * token), `error {code, message}`. The interview's own: `brief {brief,
 * stillNeeded}` after update_brief, `plan {plan, planVersion}` after
 * propose_plan, `receipt` once just before `done {messageSeq, sessionStatus}`,
 * and `ping` every 15s (ignore).
 */
export type RoleplayInterviewSseEventName =
  | 'token'
  | 'tool_call'
  | 'tool_result'
  | 'question'
  | 'brief'
  | 'plan'
  | 'receipt'
  | 'error'
  | 'done'
  | 'ping';

export interface RoleplayInterviewSseFrame {
  event: RoleplayInterviewSseEventName;
  data: Record<string, any>;
}

export interface RoleplayInterviewToolOutcome {
  modelResult: Record<string, any>;
  summary: string;
  events?: RoleplayInterviewSseFrame[];
  endTurn?: boolean;
}
