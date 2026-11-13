import { en } from "@constants";
import { AgentLogEntry } from "@types";

import { agentName, codeWords, promptName, stepName } from "../consoleLabels";

/** Stands in for the system prompt's text in a logged message (ally-ai `agent_logs.py`). */
export const SYSTEM_PROMPT_MARKER = "{{system_prompt}}";

/** An entry's plain name: "Safety reader", "Planner", "Independent check", "Case memory". */
export const entryName = (step: string): string =>
  en.debriefs.agentLogs.names[step] ??
  en.debriefs.run.stepNames[step] ??
  (en.debriefs.metrics.agents.registry.names[step] ? agentName(step) : stepName(step));

/** "Writer's prompt v3". */
export const promptLabel = (p: NonNullable<AgentLogEntry["prompt"]>): string =>
  en.debriefs.agentLogs.promptVersion(promptName(p.code), p.version);

/** The labels over an entry's two panes. */
export const paneLabels = (e: AgentLogEntry): { input: string; output: string } => {
  const t = en.debriefs.agentLogs;
  return e.kind === "model"
    ? { input: t.sent, output: t.reply }
    : { input: t.given, output: t.result };
};

/** A value that is a code (`safety_reader`, `quote_not_in_turn`), shown as words. */
const CODE = /^[a-z][a-z0-9]*(_[a-z0-9]+)+$/;
const word = (v: string): string => (CODE.test(v) ? codeWords(v) : v);

const scalar = (v: unknown): string => {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "string") return word(v);
  return String(v);
};

/** A key in words: "ceilingUsd" → "Ceiling (USD)", "learner_turns" → "Learner turns". */
const keyWords = (k: string): string => {
  const unit = /Usd$/.test(k) ? " (USD)" : /Ms$/.test(k) ? " (ms)" : "";
  const base = unit ? k.replace(/(Usd|Ms)$/, "") : k;
  return codeWords(base.replace(/([a-z0-9])([A-Z])/g, "$1_$2")) + unit;
};

const isScalar = (v: unknown) => v === null || typeof v !== "object";

/**
 * A code step's inputs or results as plain lines: keys and codes in words, lists one per line.
 * The Raw JSON view keeps the codes.
 */
export const plainText = (value: unknown, indent = ""): string => {
  if (isScalar(value)) return indent + scalar(value);
  if (Array.isArray(value)) {
    if (!value.length) return `${indent}none`;
    if (value.every(isScalar)) return indent + value.map(scalar).join(", ");
    return value
      .map(item =>
        isScalar(item)
          ? `${indent}- ${scalar(item)}`
          : `${indent}- ${plainText(item, `${indent}  `).trimStart()}`,
      )
      .join("\n");
  }
  const lines: string[] = [];
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const key = keyWords(k);
    if (isScalar(v) || (Array.isArray(v) && v.every(isScalar))) {
      lines.push(`${indent}${key}: ${plainText(v).trim()}`);
    } else {
      lines.push(`${indent}${key}:`);
      lines.push(plainText(v, `${indent}  `));
    }
  }
  return lines.length ? lines.join("\n") : `${indent}none`;
};

const pretty = (v: unknown): string =>
  typeof v === "string" ? v : v === null || v === undefined ? "" : JSON.stringify(v, null, 2);

/**
 * What the Sent pane shows. A model's message is shown as sent, the system prompt named in
 * place of its text (Show expands it above); a code step's inputs as plain lines.
 */
export const readableInput = (e: AgentLogEntry): string => {
  if (e.kind === "model" && typeof e.input === "string") {
    return e.prompt
      ? e.input.replace(
          SYSTEM_PROMPT_MARKER,
          `[${en.debriefs.agentLogs.systemPrompt}: ${promptLabel(e.prompt)}]`,
        )
      : e.input;
  }
  return e.kind === "model" ? pretty(e.input) : plainText(e.input);
};

export const readableOutput = (e: AgentLogEntry): string => {
  if (e.output === null || e.output === undefined) {
    return e.error ? `${en.debriefs.agentLogs.error}: ${e.error}` : en.debriefs.agentLogs.noReply;
  }
  const body = e.kind === "model" ? pretty(e.output) : plainText(e.output);
  return e.error ? `${body}\n\n${en.debriefs.agentLogs.error}: ${e.error}` : body;
};

/** The message exactly as sent: the version's text put back in place of the marker. */
export const exactInput = (e: AgentLogEntry, prompts: Record<string, string>): string => {
  if (typeof e.input !== "string") return pretty(e.input);
  const text = e.prompt ? prompts[`${e.prompt.code}@${e.prompt.version}`] : undefined;
  return text !== undefined ? e.input.replace(SYSTEM_PROMPT_MARKER, () => text) : e.input;
};

export const rawInput = (e: AgentLogEntry): string => JSON.stringify(e.input, null, 2);
export const rawOutput = (e: AgentLogEntry): string =>
  JSON.stringify({ output: e.output, error: e.error }, null, 2);
