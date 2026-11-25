/**
 * Roleplay interview (Studio's Agent Builder tab, Copilot-style): the brief the agent fills from
 * the trainer's answers, the plan it proposes, and what approving the plan hands the build.
 * Mirrors ally-be `src/course-copilot/roleplay-interview`.
 */
import type { RoleplayMode } from "../api/agentBuilder";

export interface RoleplayInterviewBrief {
  learners?: { who: string; priorExperience?: string };
  learnerProfileId?: string;
  learnerProfileName?: string;
  goal?: string;
  competencyIds?: string[];
  competencyNames?: string[];
  mode?: RoleplayMode;
  difficulty?: "EASY" | "MEDIUM" | "HARD";
  client?: { description?: string; characterId?: string; characterName?: string };
  /** Server-kept: the library search, its matches and the trainer's choice of character. */
  characterChoice?: { searched: boolean; matches: number; decision?: "library" | "new" };
  /** The library character made from this roleplay's new character. */
  savedCharacter?: { id: string; name: string };
  setting?: string;
  languages?: { languageId: string; label: string; code: string }[];
  behaviours?: { helpful: string[]; unhelpful: string[] };
  triggerWarningIds?: string[];
  minScore?: number;
  lengthMinutes?: number;
  notes?: string[];
}

export interface RoleplayInterviewPlan {
  version: number;
  title: string;
  characterSheet: {
    name: string;
    summary: string;
    hides: string;
    opensUpWhen: string;
    speaks: string;
  };
  moments: string[];
  states: { name: string; guidelines: string }[];
  passCriteria: { helpful: string[]; unhelpful: string[]; minScore: number };
  openingLine: string;
  supports?: {
    experienceMode?: string;
    remindersEnabled?: boolean;
    currentState?: boolean;
    supervisorNotesEnabled?: boolean;
  };
}

export type RoleplayInterviewStatus = "INTERVIEWING" | "PLAN_READY" | "APPROVED" | "ABANDONED";

export interface RoleplayInterviewSession {
  id: string;
  status: RoleplayInterviewStatus;
  brief: RoleplayInterviewBrief;
  stillNeeded: string[];
  plan: RoleplayInterviewPlan | null;
  planVersion: number;
  scenarioId: number | null;
  createdAt: string;
  updatedAt: string;
}

/** What approving the plan hands the existing generation pipeline. */
export interface RoleplayInterviewGeneration {
  actorDescription: string;
  competencyId: string;
  competencyIds: string[];
  competencyName: string;
  mode: RoleplayMode;
  difficulty?: string;
  characterId?: string;
  languages?: { languageId: string; label: string; code: string }[];
  agentTestCases: string;
  minScore?: number;
  lengthMinutes?: number;
  triggerWarningIds?: string[];
  states: { name: string; guidelines: string }[];
}

/** A persisted transcript row, as GET sessions/:id returns it. */
export interface RoleplayInterviewServerMessage {
  seq: number;
  role: "user" | "assistant";
  content: string;
  questions?: import("./agentChat").AgentQuestionEvent[];
  receipt?: unknown;
  plan?: RoleplayInterviewPlan;
  error?: string;
}
