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
      `Setting · ${s.key === GUIDANCE_TOOLS_KEY ? 'Guidance tools' : humanise(s.key)}`,
    );
  }
  for (const s of diff.steps) {
    out.push(
      s.field === 'enabled'
        ? `Step · ${stepLabel(s.step)} ${s.after ? 'on' : 'off'}`
        : `Model · ${s.step}${s.field === 'backupModel' ? ' (backup)' : ''}`,
    );
  }
  for (const r of diff.recipes) out.push(`Recipe · ${r.recipe}`);
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
