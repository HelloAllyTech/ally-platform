import { en } from "@constants";
import { DebriefModelChoice, DebriefModels, DebriefOwnerSettingSpec } from "@types";

/*
 * Plain names for the codes the Debrief Console receives. Every screen reads its labels from
 * here, so no raw id or code reaches the page: a code with no entry in its map falls back to
 * words (underscores to spaces, first letter capitalised), never the id itself.
 */

/** "missed_risk_cue" → "Missed risk cue"; "debrief_writer_system" → "Debrief writer system". */
export const codeWords = (code: string | null | undefined): string => {
  if (!code) return "—";
  const t = code
    .replace(/[_.\-:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "—";
};

const from =
  (map: () => Record<string, string>) =>
  (code: string | null | undefined): string =>
    code ? (map()[code] ?? codeWords(code)) : "—";

export const checkLabel = from(() => en.debriefs.metrics.codeLabels.checks);
export const plannerFallbackLabel = from(() => en.debriefs.metrics.codeLabels.plannerFallback);
export const hardFailLabel = from(() => en.debriefs.hardFails);
export const stepName = from(() => en.debriefs.run.stepNames);
export const recipeLabel = from(() => en.debriefs.metrics.filters.recipes);
export const levelLabel = from(() => en.debriefs.metrics.filters.levels);
export const agentName = from(() => en.debriefs.metrics.agents.registry.names);
export const settingName = from(() => en.debriefs.settings.names);
export const forecastMetricLabel = from(() => en.debriefs.pmAgent.forecastMetrics);
export const promptName = from(() => en.debriefs.pmAgent.promptNames);

/** A metric or code the PM agent may name in its own text, looked up in every label map we have. */
const knownLabel = (code: string): string | undefined =>
  en.debriefs.gateMeasures[code] ??
  en.debriefs.pmAgent.forecastMetrics[code] ??
  en.debriefs.run.stepNames[code] ??
  (en.debriefs.hardFails as Record<string, string>)[code] ??
  en.debriefs.metrics.codeLabels.checks[code] ??
  en.debriefs.settings.names[code];

/**
 * Text the PM agent wrote, with the codes it named turned into their plain names. Only codes we
 * have a label for are replaced (a bare snake_case token, one in backticks, or "step.metric"), so
 * ordinary prose is left exactly as written.
 */
export const inWords = (text: string | null | undefined): string => {
  if (!text) return "";
  return text.replace(
    /`?\b([a-z][a-z0-9]*(?:_[a-z0-9]+)*)(?:\.([a-z][a-z0-9]*(?:_[a-z0-9]+)+))?\b`?/g,
    (m, a: string, b?: string) => {
      if (b) {
        const step = en.debriefs.run.stepNames[a];
        const metric = knownLabel(b);
        return step && metric ? `${step}: ${metric.charAt(0).toLowerCase()}${metric.slice(1)}` : m;
      }
      if (!a.includes("_")) return m;
      return knownLabel(a) ?? m;
    },
  );
};

/**
 * A canary's reason: either one of the few codes ally-be records, or a sentence it already
 * wrote in English (debrief-ladder.util `canaryDecision`), which is shown as it is.
 */
export const canaryReasonLabel = (reason: string): string => {
  const known = en.debriefs.pmAgent.canaryReasons[reason];
  if (known) return known;
  return /^[a-z0-9_]+$/.test(reason) ? codeWords(reason) : reason;
};

/** A session language: "hi-IN" or "hi" → "Hindi". An unknown code is shown as it is. */
export const languageLabel = (code: string | null | undefined): string => {
  if (!code) return "—";
  const map = en.debriefs.languages;
  return map[code] ?? map[code.split(/[-_]/)[0].toLowerCase()] ?? code;
};

/**
 * A card section by its path in the cards, as ally-be's checks record it
 * (`what_worked[0]`, `important_moment.others[1]`, `work_on_this.2`): "What worked, point 1".
 */
export const sectionLabel = (path: string | null | undefined): string => {
  if (!path) return "—";
  const s = en.debriefs.run.sections;
  const parts = path.match(/[a-z_]+|\d+/gi) ?? [];
  const [head, ...rest] = parts;
  if (!head) return codeWords(path);
  const words: string[] = [s.names[head] ?? codeWords(head)];
  for (let i = 0; i < rest.length; i++) {
    const p = rest[i];
    if (/^\d+$/.test(p)) words.push(s.point(Number(p) + 1));
    else {
      const next = rest[i + 1];
      const name = s.names[p] ?? codeWords(p).toLowerCase();
      if (next && /^\d+$/.test(next)) {
        words.push(s.numbered(name, Number(next) + 1));
        i++;
      } else words.push(name);
    }
  }
  return words.join(", ");
};

/** An owner setting's value in words: yes/no, a share as a percentage, otherwise the number. */
export const settingValueLabel = (spec: DebriefOwnerSettingSpec, v: number | boolean): string =>
  typeof v === "boolean"
    ? v
      ? en.debriefs.settings.yes
      : en.debriefs.settings.no
    : spec.kind === "share"
      ? `${Math.round(v * 1000) / 10}%`
      : String(v);

/**
 * A setting change the PM agent proposed (`settingKey`, `settingValue`), in words. The value
 * comes as a string; with the setting's spec it reads as the Settings tab shows it.
 */
export const settingChangeLabel = (
  key: string | null,
  value: string | null,
  spec?: DebriefOwnerSettingSpec,
): string => {
  const name = settingName(key);
  if (value == null) return name;
  const n = Number(value);
  const shown =
    spec && Number.isFinite(n)
      ? settingValueLabel(spec, spec.kind === "bool" ? n !== 0 : n)
      : value;
  return en.debriefs.pmAgent.settingChange(name, shown);
};

/** The model catalog's labels (the console's models query), by model id. */
export const modelLabels = (data: DebriefModels | undefined): ((id: string) => string) => {
  const choices: DebriefModelChoice[] = [
    ...(data?.choices.steps ?? []),
    ...(data?.choices.reply ?? []),
  ];
  const byId = new Map(choices.map(c => [c.model, c.label]));
  return (id: string) => byId.get(id) ?? id;
};
