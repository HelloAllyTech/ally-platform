import {
  AllyGuidePlaygroundBody,
  AllyGuidePlaygroundIntent,
  AllyGuidePlaygroundResult,
  AllyGuidePlaygroundTurn,
} from "@types";

export const PLAYGROUND_MESSAGE_MAX = 2000;
export const PLAYGROUND_PROGRESS_MAX = 500;
/** ally-be keeps only the last 20 turns of history. */
export const PLAYGROUND_HISTORY_MAX = 20;

/** Items completed, typed as plain digits from 0 to 500, or null. Empty means 0. */
export const parseProgress = (text: string): number | null => {
  const trimmed = text.trim();
  if (trimmed === "") return 0;
  if (!/^\d{1,3}$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value <= PLAYGROUND_PROGRESS_MAX ? value : null;
};

/** One line the imagined learner sent, and what one release made of it. */
export interface PaneTurn {
  id: number;
  learner: string;
  intent?: AllyGuidePlaygroundIntent;
  status: "running" | "done" | "error";
  result?: AllyGuidePlaygroundResult;
  error?: string;
  /** The person stopped waiting. The server may still finish the run. */
  stopped?: boolean;
}

/**
 * The conversation so far as the server wants it: plain text, in order. Only turns that finished
 * count, so a failed run leaves no hole of its own making. An action sent alone adds only Ally's reply.
 */
export const historyFor = (turns: PaneTurn[]): AllyGuidePlaygroundTurn[] => {
  const history: AllyGuidePlaygroundTurn[] = [];
  for (const turn of turns) {
    if (turn.status !== "done" || !turn.result) continue;
    if (turn.learner) history.push({ role: "learner", text: turn.learner });
    history.push({ role: "ally", text: turn.result.reply });
  }
  return history.slice(-PLAYGROUND_HISTORY_MAX);
};

export interface Scenario {
  trackId: string;
  tenantId: string;
  progress: number;
  mode: "NORMAL" | "CARE" | "CRISIS_FOLLOWUP";
  guidance: "lead" | "walk" | "drive";
  channel: "text" | "voice";
  visitor: boolean;
}

/** The request for one release. A visitor has no progress and no organisation layer, so neither is sent. */
export const buildBody = (
  scenario: Scenario,
  releaseId: string,
  message: string,
  intent: AllyGuidePlaygroundIntent | undefined,
  history: AllyGuidePlaygroundTurn[],
): AllyGuidePlaygroundBody => ({
  releaseId,
  trackId: scenario.trackId,
  message,
  mode: scenario.mode,
  guidance: scenario.guidance,
  channel: scenario.channel,
  history,
  ...(scenario.visitor
    ? { visitor: true }
    : {
        progress: scenario.progress,
        ...(scenario.tenantId ? { tenantId: scenario.tenantId } : {}),
      }),
  ...(intent ? { intent } : {}),
});

/** Total tokens in, out and read from cache across the passes of one turn. */
export const sumUsage = (
  usage: AllyGuidePlaygroundResult["usage"] | undefined,
): { input: number; output: number; cached: number } =>
  (usage ?? []).reduce(
    (total, pass) => ({
      input: total.input + (pass.inputTokens ?? 0),
      output: total.output + (pass.outputTokens ?? 0),
      cached: total.cached + (pass.cachedTokens ?? 0),
    }),
    { input: 0, output: 0, cached: 0 },
  );
