/** Debrief Settings › Agents: the live release's recipes, models and tools (GET agents-config). */
export interface DebriefAgentAuthor {
  kind: "pm_agent" | "person" | "system";
  name: string | null;
}

export interface DebriefAgentRecentChange {
  releaseId: string;
  version: number;
  status: string;
  author: DebriefAgentAuthor;
  at: string;
  summary: string[];
  source: "pm_agent" | "person" | "seed";
}

export interface DebriefAgentStep {
  step: string;
  label: string;
  model: string | null;
  backupModel: string | null;
  promptCode: string | null;
  optional: boolean;
}

export interface DebriefAgentRecipe {
  key: string;
  shortForm: boolean;
  maxRevisionRounds: number;
  /** One line: what the recipe is for and the rule that picks it (absent on an older backend). */
  usedWhen?: string;
  steps: DebriefAgentStep[];
}

/** One agent of the Debrief system (steps, the planner, the planner's own agents). */
export interface DebriefAgentRow {
  id: string;
  name: string;
  kind: "step" | "planner" | "data";
  /** One line on what it does; null when nothing in the system describes it. */
  what: string | null;
  when: string | null;
  runs: "always" | "some_recipes" | "optional" | "planner" | "off";
  promptCode: string | null;
  /** Recipe keys whose steps include it (steps only). */
  recipes: string[];
  /** The planner may choose it; `enabled` is the live release's switch. */
  plannerChoice: { enabled: boolean } | null;
  /** Planner and planner agents: the release's own model (steps: read from the recipes). */
  model: string | null;
  backupModel: string | null;
}

/** One kind of data an agent can read (ally-be `DATA_ITEMS`). */
export interface DebriefDataItem {
  key: string;
  label: string;
  description: string;
  group:
    | "this session"
    | "the roleplay"
    | "the learner"
    | "other learners"
    | "the library"
    | "other agents";
  /** Who may change whether it is read: nobody (fixed), a release setting, or only the owner. */
  control: "fixed" | "setting" | "owner";
  personal?: boolean;
}

export interface DebriefAgentReads {
  key: string;
  label: string;
  reads: { data: string; when: string | null }[];
}

export interface DebriefPmTool {
  tool: string;
  kind: "read" | "act";
  reads: string;
}

export interface DebriefRoleplayField {
  key: string;
  label: string;
  description: string;
  alwaysOn: boolean;
  defaultOn: boolean;
  enabled: boolean;
}

/** What each agent can read, and the optional roleplay fields the live release has on. */
export interface DebriefDataAccess {
  data: DebriefDataItem[];
  agents: DebriefAgentReads[];
  pmAgent: DebriefPmTool[];
  roleplayFields: DebriefRoleplayField[];
}

export interface DebriefAgentsConfig {
  release: { id: string; version: number; status: string };
  canEdit: boolean;
  recipes: DebriefAgentRecipe[];
  /** Every agent, in run order. Absent from an older backend. */
  agents?: DebriefAgentRow[];
  settings: {
    guidanceAgentMaxCalls: number;
    guidanceTools: Record<string, string[]>;
    /** The optional roleplay fields the release reads. Absent from an older backend. */
    roleplayFields?: string[];
  };
  /** Absent from an older backend. */
  dataAccess?: DebriefDataAccess;
  limits: {
    guidanceAgentMaxCalls: { min: number; max: number };
    guidanceToolSteps: string[];
    guidanceToolNames: string[];
  };
  orchestratorAgents: { id: string; version: number; enabled: boolean }[];
  models: { id: string; provider: string; label: string }[];
  pendingDraft: null | {
    id: string;
    version: number;
    status: string;
    note: string | null;
    author?: DebriefAgentAuthor;
  };
  /** Newest first. Absent from an older backend. */
  recentChanges?: DebriefAgentRecentChange[];
  canary?: { id: string; version: number; share: number } | null;
}

export type DebriefAgentsChange =
  | { kind: "model"; recipe: string; step: string; model: string; backupModel: string | null }
  | {
      kind: "setting";
      key: "guidanceAgentMaxCalls" | "guidanceTools" | "roleplayFields";
      value: number | Record<string, string[]> | string[];
    }
  | { kind: "orchestrator_agent"; id: string; enabled: boolean };

export interface DebriefAgentsChangesBody {
  changes: DebriefAgentsChange[];
  note?: string;
}

export interface DebriefAgentsChangesResult {
  draft: { id: string; version: number; status: string; author?: DebriefAgentAuthor };
  waitsForPerson: boolean;
  reason: string | null;
}

export interface DebriefAgentsRefusals {
  message: string;
  refusals: { index: number; reason: string }[];
}
