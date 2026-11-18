import {
  DEBRIEF_REGISTRY_AGENTS,
  DebriefBundle,
  DebriefRecipeKey,
  DebriefStep,
  GUIDANCE_TOOL_NAMES,
  GUIDANCE_TOOL_STEPS,
  GUIDANCE_TOOLS_DEFAULT,
  PM_AGENT_SETTINGS,
  DEBRIEF_PROMPT_CODES,
} from '../constants/debrief-release.constants';
import {
  GUIDANCE_TOOLS_KEY,
  parseGuidanceTools,
  settingRefusal,
  settingValueOf,
} from './debrief-pm-agent-rules.util';
import { ROLEPLAY_FIELDS_KEY } from '../constants/debrief-roleplay-fields.constants';
import {
  BundleDiff,
  OPTIONAL_STEPS,
  promptLabel,
  stepLabel,
} from './debrief-releases.util';

/**
 * Settings › Agents: what a person (or the Debrief PM agent) may change, and
 * the one place that checks it. A change never edits a live release: it makes
 * a DRAFT release through the same path as a person's proposed change.
 */

export type AgentsConfigChange =
  | {
      kind: 'model';
      recipe: string;
      step: string;
      model: string;
      backupModel?: string | null;
    }
  | { kind: 'setting'; key: string; value: unknown }
  | { kind: 'orchestrator_agent'; id: string; enabled: boolean };

/** Settings this page edits (the PM agent's range-checked ones plus the guidance tools). */
export const AGENTS_CONFIG_SETTING_KEYS = [
  'guidanceAgentMaxCalls',
  GUIDANCE_TOOLS_KEY,
  ROLEPLAY_FIELDS_KEY,
] as const;

/** Steps with no model slot: code runs them. */
const NO_MODEL_STEPS: readonly string[] = [
  DebriefStep.CHECKS,
  DebriefStep.GUIDANCE_LOOKUP,
];

/** The Skills Store prompt each step runs; null for a step code runs. */
export const STEP_PROMPT_CODES: Record<string, string | null> = {
  [DebriefStep.SAFETY_READER]: DEBRIEF_PROMPT_CODES.safetyReader,
  [DebriefStep.ANALYST]: DEBRIEF_PROMPT_CODES.analyst,
  [DebriefStep.PROGRESS_READER]: DEBRIEF_PROMPT_CODES.progressReader,
  [DebriefStep.GUIDANCE_LOOKUP]: null,
  [DebriefStep.GUIDANCE_AGENT]: DEBRIEF_PROMPT_CODES.guidanceAgent,
  [DebriefStep.WRITER]: DEBRIEF_PROMPT_CODES.writer,
  [DebriefStep.CHECKS]: null,
  [DebriefStep.EVALUATOR]: DEBRIEF_PROMPT_CODES.evaluator,
  [DebriefStep.REVISER]: DEBRIEF_PROMPT_CODES.reviser,
};

/** The guidance tools every step has when the release names none (absent value filled in). */
export function guidanceToolsView(setting: unknown): Record<string, string[]> {
  const base =
    setting && typeof setting === 'object' && !Array.isArray(setting)
      ? (setting as Record<string, string[]>)
      : (GUIDANCE_TOOLS_DEFAULT as Record<string, string[]>);
  return Object.fromEntries(
    GUIDANCE_TOOL_STEPS.map((s) => [
      s,
      Array.isArray(base[s]) ? [...base[s]] : [],
    ]),
  );
}

/**
 * Check a batch of changes against a bundle and, when none is refused, return
 * the new bundle. Refusals carry the change's index; nothing is applied when
 * any is refused. `approvedModels`: the ids the picker offers.
 */
export function applyAgentsConfigChanges(
  bundle: DebriefBundle,
  changes: unknown,
  approvedModels: ReadonlySet<string>,
):
  | { bundle: DebriefBundle }
  | { refusals: Array<{ index: number; reason: string }> } {
  const refusals: Array<{ index: number; reason: string }> = [];
  const next = JSON.parse(JSON.stringify(bundle)) as DebriefBundle;
  if (!Array.isArray(changes) || !changes.length) {
    return { refusals: [{ index: 0, reason: 'name at least one change' }] };
  }
  changes.forEach((raw, index) => {
    const c = (raw ?? {}) as Record<string, any>;
    const refuse = (reason: string) => refusals.push({ index, reason });
    if (c.kind === 'model') {
      if (!(Object.values(DebriefRecipeKey) as string[]).includes(c.recipe)) {
        return refuse(`${c.recipe} is not a recipe`);
      }
      const recipe = next.recipes[c.recipe as DebriefRecipeKey];
      if (!recipe) return refuse(`this release has no ${c.recipe} recipe`);
      if (!(Object.values(DebriefStep) as string[]).includes(c.step)) {
        return refuse(`${c.step} is not a step`);
      }
      if (NO_MODEL_STEPS.includes(c.step)) {
        return refuse(`${c.step} runs in code and has no model`);
      }
      const s = recipe.steps.find((x) => x.step === c.step);
      if (!s) return refuse(`the ${c.recipe} recipe does not run ${c.step}`);
      const backup = c.backupModel ?? null;
      for (const m of [c.model, backup]) {
        if (m == null) continue;
        if (typeof m !== 'string' || !approvedModels.has(m)) {
          return refuse(`${m} is not an approved model`);
        }
      }
      if (typeof c.model !== 'string' || !c.model) {
        return refuse('name the model');
      }
      s.model = c.model;
      s.backupModel = backup;
    } else if (c.kind === 'setting') {
      if (!(AGENTS_CONFIG_SETTING_KEYS as readonly string[]).includes(c.key)) {
        return refuse(
          `${c.key} is not a setting here; it may be: ${AGENTS_CONFIG_SETTING_KEYS.join(', ')}`,
        );
      }
      const r = settingRefusal(c.key, c.value);
      if (r) return refuse(r.reason);
      (next.settings as unknown as Record<string, unknown>)[c.key] =
        settingValueOf(c.key, c.value);
    } else if (c.kind === 'orchestrator_agent') {
      if (!(c.id in DEBRIEF_REGISTRY_AGENTS)) {
        return refuse(`${c.id} is not a registry agent`);
      }
      if (typeof c.enabled !== 'boolean') {
        return refuse('enabled must be true or false');
      }
      if (!next.orchestrator) {
        return refuse('this release has no orchestrator; agents are off');
      }
      const agents = next.orchestrator.agents;
      const at = agents.findIndex((a) => a.id === c.id);
      if (c.enabled && at < 0) {
        agents.push({
          id: c.id,
          version:
            DEBRIEF_REGISTRY_AGENTS[
              c.id as keyof typeof DEBRIEF_REGISTRY_AGENTS
            ].version,
        });
      } else if (!c.enabled && at >= 0) {
        agents.splice(at, 1);
      }
    } else {
      refuse('kind must be model, setting or orchestrator_agent');
    }
  });
  return refusals.length ? { refusals } : { bundle: next };
}

export const AGENTS_CONFIG_LIMITS = {
  guidanceAgentMaxCalls: PM_AGENT_SETTINGS.guidanceAgentMaxCalls,
  guidanceToolSteps: [...GUIDANCE_TOOL_STEPS],
  guidanceToolNames: [...GUIDANCE_TOOL_NAMES],
};

export { parseGuidanceTools, OPTIONAL_STEPS };

export type ReleaseAuthor = {
  kind: 'pm_agent' | 'person' | 'system';
  name: string | null;
};

/**
 * Who made a release: the PM agent when its idea (not a person's proposal)
 * carries it; a person for a human release or a person's proposal; the system
 * for code defaults and the loop's own releases.
 */
export function releaseAuthor(
  r: { authorKind?: string | null; createdByName?: string | null },
  idea: { change?: Record<string, any> | null } | null,
): ReleaseAuthor {
  if (idea && idea.change?.ideaKind !== 'release') {
    return { kind: 'pm_agent', name: null };
  }
  if (idea || r.authorKind === 'human') {
    return { kind: 'person', name: r.createdByName ?? null };
  }
  return { kind: 'system', name: null };
}

export function changeSource(
  author: ReleaseAuthor,
): 'pm_agent' | 'person' | 'seed' {
  if (author.kind === 'pm_agent') return 'pm_agent';
  if (author.kind === 'person') return 'person';
  return 'seed';
}

const humanise = (k: string) => {
  const w = k.replace(/([A-Z])/g, ' $1').toLowerCase();
  return w.charAt(0).toUpperCase() + w.slice(1);
};

/** Short plain lines for a release's diff against the one before it. */
export function diffSummary(diff: BundleDiff): string[] {
  const out: string[] = [];
  for (const p of diff.prompts) out.push(`Prompt · ${promptLabel(p.code)}`);
  for (const s of diff.settings) {
    out.push(
      `Setting · ${
        s.key === GUIDANCE_TOOLS_KEY
          ? 'Guidance tools'
          : s.key === ROLEPLAY_FIELDS_KEY
            ? 'Roleplay information'
            : humanise(s.key)
      }`,
    );
  }
  for (const s of diff.steps) {
    out.push(
      s.field === 'enabled'
        ? `Step · ${stepLabel(s.step)} ${s.after ? 'on' : 'off'}`
        : `Model · ${s.step}${s.field === 'backupModel' ? ' (backup)' : ''}`,
    );
  }
  for (const r of diff.recipes) out.push(`Debrief flow · ${r.recipe}`);
  if (diff.reply) out.push('Model · Ask Ally');
  if (diff.orchestrator) out.push('Orchestrator');
  return [...new Set(out)];
}

/**
 * One line per recipe: what it is for and the rule that picks it. The rule is the runner's
 * (debrief-runner.service.ts): checked in this order, the first that holds wins.
 */
export function recipeUsedWhen(key: string, minLearnerTurns: number): string {
  switch (key) {
    case 'short':
      return `For sessions too short to coach on. Used when the learner spoke fewer than ${minLearnerTurns} times (checked 1st): one short card.`;
    case 'assessment':
      return 'For an assessed attempt. Used when the roleplay is an assessment in a track, assessment mode on (checked 2nd). Runs the same steps as Standard today; kept separate so assessed debriefs can differ.';
    case 'case':
      return 'For a session that is part of a case. Used when it was started from a case in a learning path (checked 3rd). Runs the same steps as Standard today; kept separate so case debriefs can differ.';
    case 'standard':
      return 'The full debrief for a normal roleplay: key moments with quotes, what to work on, and a skill to practise next. Used for everything else (checked last).';
    default:
      return '';
  }
}

// --- Every agent in the Debrief system, and which recipe uses which (Settings › Agents) ----------

/** Plain names for every agent: the code-owned steps, the planner and the planner's own agents. */
export const AGENT_NAMES: Record<string, string> = {
  safety_reader: 'Safety reader',
  analyst: 'Analyst',
  progress_reader: 'Progress reader',
  guidance_lookup: 'Guidance lookup',
  guidance_agent: 'Guidance agent',
  writer: 'Writer',
  checks: 'Checks',
  evaluator: 'Evaluator',
  reviser: 'Reviser',
  planner: 'Planner',
  case_memory: 'Case memory',
  assessment_anchoring: 'Assessment anchoring',
  protocol_check: 'Protocol check',
  history_deep: 'Learner history',
  language_specialist: 'Language specialist',
  cohort_comparison: 'Organisation comparison',
  course_patterns: 'Course patterns',
};

/** The AI Tasks page entry that already describes each agent (`AI_TASK_REGISTRY` ids). */
export const AGENT_TASK_IDS: Record<string, string> = {
  safety_reader: 'debrief-safety-reader',
  analyst: 'debrief-analyst',
  progress_reader: 'debrief-progress-reader',
  guidance_agent: 'debrief-guidance-agent',
  writer: 'debrief-writer',
  evaluator: 'debrief-evaluator',
  reviser: 'debrief-reviser',
  planner: 'debrief-planner',
  protocol_check: 'debrief-protocol-check',
  history_deep: 'debrief-history-deep',
  language_specialist: 'debrief-language-specialist',
};

/** The part of an agent's text a person reads at a glance: up to the first full stop. */
export function firstSentence(text: string | null | undefined): string | null {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const m = /^(.+?[.!?])(\s|$)/.exec(t);
  const out = (m ? m[1] : t).trim();
  return out.length > 220 ? `${out.slice(0, 217)}…` : out;
}

/**
 * The planner's wording for its agents (the Skills Store prompt `debrief_planner_agents`): one
 * `## <agent id>` section each with a `description:` line. Anything else in the text is ignored.
 */
export function parsePlannerAgentDescriptions(
  text: string | null | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  let id: string | null = null;
  for (const raw of (text ?? '').split('\n')) {
    const line = raw.trim();
    const head = /^##\s+([a-z0-9_]+)\s*$/.exec(line);
    if (head) {
      id = head[1];
      continue;
    }
    const d = /^description:\s*(.+)$/i.exec(line);
    if (id && d && !out[id]) out[id] = d[1].trim();
  }
  return out;
}

/** How an agent takes part in the live release. */
export type AgentRuns =
  /** A step of every recipe. */
  | 'always'
  /** A step of some recipes only. */
  | 'some_recipes'
  /** A step a draft may turn off. */
  | 'optional'
  /** The planner may choose it for a session. */
  | 'planner'
  /** Not in the live release (or the planner is off). */
  | 'off';

export interface AgentView {
  id: string;
  name: string;
  /** `step`: part of recipes; `planner`: the planner itself; `data`: only the planner chooses it. */
  kind: 'step' | 'planner' | 'data';
  /** One line on what it does; null when nothing in the system describes it. */
  what: string | null;
  /** When it runs, where the system says so. */
  when: string | null;
  runs: AgentRuns;
  /** The Skills Store prompt it runs; null for code. */
  promptCode: string | null;
  /** Recipe keys whose steps include it (steps only). */
  recipes: string[];
  /** A registry agent the planner may choose, with whether the live release has it on. */
  plannerChoice: { enabled: boolean } | null;
  /** Planner and registry agents: the release's own model (steps: read from `recipes`). */
  model: string | null;
  backupModel: string | null;
}

/** Order of the steps in the list (the order a debrief runs them). */
const STEP_ORDER = Object.values(DebriefStep) as string[];

/**
 * Every agent the Debrief system has, from the live bundle: the steps in the order a run takes
 * them, the planner, then the agents only the planner chooses. `describe` finds the one-line
 * description and the "when" of an agent id (planner wording, then the AI Tasks page).
 */
export function agentsView(
  bundle: DebriefBundle,
  describe: (id: string) => { what: string | null; when: string | null },
): AgentView[] {
  const recipes = Object.values(bundle.recipes).filter(Boolean);
  const orch = bundle.orchestrator;
  const inBundle = new Map(
    (orch?.agents ?? []).map((a) => [a.id as string, a]),
  );
  const plannerChoice = (id: string) =>
    id in DEBRIEF_REGISTRY_AGENTS
      ? { enabled: !!orch?.enabled && inBundle.has(id as never) }
      : null;
  const stepIds = STEP_ORDER.filter((id) =>
    recipes.some((r) => r!.steps.some((st) => st.step === id)),
  );
  const out: AgentView[] = stepIds.map((id) => {
    const using = recipes.filter((r) => r!.steps.some((st) => st.step === id));
    const optional = (OPTIONAL_STEPS as readonly string[]).includes(id);
    const runs: AgentRuns = optional
      ? 'optional'
      : using.length === recipes.length
        ? 'always'
        : 'some_recipes';
    return {
      id,
      name: AGENT_NAMES[id] ?? id,
      kind: 'step' as const,
      ...describe(id),
      runs,
      promptCode: STEP_PROMPT_CODES[id] ?? null,
      recipes: using.map((r) => r!.key),
      plannerChoice: plannerChoice(id),
      model: null,
      backupModel: null,
    };
  });
  out.push({
    id: 'planner',
    name: AGENT_NAMES.planner,
    kind: 'planner',
    ...describe('planner'),
    runs: orch?.enabled ? 'always' : 'off',
    promptCode: DEBRIEF_PROMPT_CODES.planner ?? null,
    recipes: [],
    plannerChoice: null,
    model: orch?.plannerModel ?? null,
    backupModel: orch?.plannerBackupModel ?? null,
  });
  for (const id of Object.keys(DEBRIEF_REGISTRY_AGENTS)) {
    if (stepIds.includes(id)) continue;
    const choice = plannerChoice(id);
    const own = inBundle.get(id as never);
    out.push({
      id,
      name: AGENT_NAMES[id] ?? id,
      kind: 'data',
      ...describe(id),
      runs: choice?.enabled ? 'planner' : 'off',
      promptCode: null,
      recipes: [],
      plannerChoice: choice,
      model: own?.model ?? null,
      backupModel: own?.backupModel ?? null,
    });
  }
  return out;
}
