import { DynamicI18nAggregatedRow } from "@types";

export interface PendingChange {
  fullKey: string;
  namespace: string;
  innerKey: string;
  language: string;
  live: string;
  draft: string;
}

/**
 * Every (key, language) whose saved draft differs from what is live.
 *
 * "Unpublished" is a property of the saved draft, not of text still being typed
 * in a cell, so unsaved edits are not counted here.
 */
export const computePendingChanges = (
  rows: DynamicI18nAggregatedRow[],
  languages: string[],
): PendingChange[] => {
  const out: PendingChange[] = [];
  for (const row of rows) {
    for (const language of languages) {
      const draft = row.values[language] ?? "";
      const live = row.liveValues?.[language] ?? "";
      if (draft !== live) {
        out.push({
          fullKey: row.fullKey,
          namespace: row.namespace,
          innerKey: row.innerKey,
          language,
          live,
          draft,
        });
      }
    }
  }
  return out;
};

export const MISSING_ANY = "__any";

/** A row is missing a translation when English exists but the language is blank. */
export const isMissing = (
  row: DynamicI18nAggregatedRow,
  languages: string[],
  language: string,
  source = "en",
): boolean => {
  const targets = language === MISSING_ANY ? languages.filter(l => l !== source) : [language];
  return targets.some(l => (row.values[l] ?? "").trim() === "");
};

const csvCell = (value: string) => `"${value.replace(/"/g, '""')}"`;

export const toCsv = (rows: DynamicI18nAggregatedRow[], languages: string[]): string => {
  const header = ["key", ...languages].map(csvCell).join(",");
  const body = rows.map(row =>
    [row.fullKey, ...languages.map(l => row.values[l] ?? "")].map(csvCell).join(","),
  );
  return [header, ...body].join("\n");
};

/** Minimal RFC-4180 parser (quoted cells, doubled quotes, newlines inside quotes). */
export const parseCsv = (text: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell);
      cell = "";
      if (row.some(c => c !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some(c => c !== "")) rows.push(row);
  return rows;
};

export interface ImportPlan {
  changes: Array<PendingChange & { current: string }>;
  unknownKeys: string[];
  unknownLanguages: string[];
}

/** Diff an uploaded CSV against the current drafts. Only existing keys/languages are applied. */
export const planImport = (
  csv: string[][],
  rows: DynamicI18nAggregatedRow[],
  languages: string[],
): ImportPlan => {
  const [header = [], ...data] = csv;
  const byKey = new Map(rows.map(r => [r.fullKey, r]));
  const cols = header.slice(1);
  const unknownLanguages = cols.filter(c => !languages.includes(c));
  const changes: ImportPlan["changes"] = [];
  const unknownKeys: string[] = [];
  for (const line of data) {
    const row = byKey.get(line[0]);
    if (!row) {
      unknownKeys.push(line[0]);
      continue;
    }
    cols.forEach((language, idx) => {
      if (!languages.includes(language)) return;
      const next = line[idx + 1] ?? "";
      const current = row.values[language] ?? "";
      if (next !== current) {
        changes.push({
          fullKey: row.fullKey,
          namespace: row.namespace,
          innerKey: row.innerKey,
          language,
          live: row.liveValues?.[language] ?? "",
          draft: next,
          current,
        });
      }
    });
  }
  return { changes, unknownKeys, unknownLanguages };
};
