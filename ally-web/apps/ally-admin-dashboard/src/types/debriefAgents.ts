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

export interface DebriefAgentsConfig {
  release: { id: string; version: number; status: string };
  canEdit: boolean;
  recipes: DebriefAgentRecipe[];
  settings: { guidanceAgentMaxCalls: number; guidanceTools: Record<string, string[]> };
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
      key: "guidanceAgentMaxCalls" | "guidanceTools";
      value: number | Record<string, string[]>;
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
