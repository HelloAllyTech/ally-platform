import React from "react";

import { Tooltip } from "@ally-ui-mono/ui-shared";
import { TooltipIcon } from "@assets";

import type { TemplateIssue } from "./templatesAdminApi";

export const buttonClass =
  "rounded-md bg-primary-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50";
export const secondaryClass =
  "rounded-md border border-border-light px-3 py-1.5 text-sm font-medium disabled:opacity-50";
export const dangerClass =
  "rounded-md border border-red-700 px-3 py-1.5 text-sm font-medium text-red-700 disabled:opacity-50";
export const inputClass = "border border-border-light rounded-md px-3 py-2 text-sm w-full";

/** The problems at or under a path: `lists.2` covers `lists.2.line`. */
export const issuesAt = (issues: TemplateIssue[], path: string): TemplateIssue[] =>
  issues.filter(i => i.path === path || i.path.startsWith(`${path}.`));

/** Only the problems exactly at a path (what a single field shows). */
export const issuesOn = (issues: TemplateIssue[], path: string): TemplateIssue[] =>
  issues.filter(i => i.path === path);

/** A new array with item `i` replaced by `next`. */
export const replaceAt = <T,>(list: T[], i: number, next: T): T[] =>
  list.map((x, n) => (n === i ? next : x));

/** A new array with item `i` removed. */
export const removeAt = <T,>(list: T[], i: number): T[] => list.filter((_, n) => n !== i);

/** A new array with item `i` moved by `by` places (kept in range). */
export const moveBy = <T,>(list: T[], i: number, by: number): T[] => {
  const to = i + by;
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  [next[i], next[to]] = [next[to], next[i]];
  return next;
};

export const toLines = (text: string): string[] =>
  text
    .split("\n")
    .map(l => l.trim())
    .filter(Boolean);

export const fromLines = (lines: string[] | undefined): string => (lines ?? []).join("\n");

/** A help tooltip for a control that isn't obvious from its label. */
export const Hint: React.FC<{ label: string }> = ({ label }) => (
  <Tooltip label={label} align="top">
    <button type="button" className="cursor-pointer inline-flex items-center" aria-label={label}>
      <TooltipIcon />
    </button>
  </Tooltip>
);

/** What a field shows when the server found something wrong with it. */
export const Problems: React.FC<{ issues: TemplateIssue[] }> = ({ issues }) =>
  issues.length ? (
    <ul className="space-y-0.5" data-testid="field-problems">
      {issues.map((i, n) => (
        <li
          key={n}
          className={
            i.severity === "error" ? "text-xs text-red-700" : "text-xs text-typography-600"
          }
        >
          {i.message}
        </li>
      ))}
    </ul>
  ) : null;

interface FieldProps {
  label: string;
  hint?: string;
  tip?: string;
  issues?: TemplateIssue[];
  children: React.ReactNode;
  className?: string;
}

/** A labelled control with its help line and its problems. */
export const Field: React.FC<FieldProps> = ({
  label,
  hint,
  tip,
  issues = [],
  children,
  className,
}) => (
  <label className={`block text-sm space-y-1 ${className ?? ""}`}>
    <span className="inline-flex items-center gap-1 font-medium">
      {label}
      {tip && <Hint label={tip} />}
    </span>
    {children}
    {hint && <span className="block text-xs text-typography-600">{hint}</span>}
    <Problems issues={issues} />
  </label>
);

export const TextInput: React.FC<
  Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange"> & {
    value: string;
    onChange: (value: string) => void;
  }
> = ({ onChange, ...rest }) => (
  <input className={inputClass} {...rest} onChange={e => onChange(e.target.value)} />
);

export const TextArea: React.FC<{
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  testId?: string;
}> = ({ value, onChange, rows = 3, testId }) => (
  <textarea
    className={inputClass}
    rows={rows}
    value={value}
    data-testid={testId}
    onChange={e => onChange(e.target.value)}
  />
);

export const Select: React.FC<{
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string; disabled?: boolean }[];
  testId?: string;
}> = ({ value, onChange, options, testId }) => (
  <select
    className={inputClass}
    value={value}
    data-testid={testId}
    onChange={e => onChange(e.target.value)}
  >
    {options.map(o => (
      <option key={o.value} value={o.value} disabled={o.disabled}>
        {o.label}
      </option>
    ))}
  </select>
);

export const Check: React.FC<{
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  testId?: string;
}> = ({ label, hint, checked, onChange, testId }) => (
  <label className="flex items-start gap-2 text-sm">
    <input
      type="checkbox"
      className="mt-1"
      checked={checked}
      data-testid={testId}
      onChange={e => onChange(e.target.checked)}
    />
    <span>
      <span className="font-medium">{label}</span>
      {hint && <span className="block text-xs text-typography-600">{hint}</span>}
    </span>
  </label>
);

/** A bordered group with a title row (name on the left, actions on the right). */
export const Card: React.FC<{
  title: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  testId?: string;
  problems?: number;
}> = ({ title, actions, children, testId, problems = 0 }) => (
  <section
    className={`rounded-md border p-3 space-y-3 ${problems ? "border-red-700" : "border-border-light"}`}
    data-testid={testId}
  >
    <header className="flex flex-wrap items-center justify-between gap-2">
      <h4 className="font-medium text-sm">{title}</h4>
      <div className="flex items-center gap-2">{actions}</div>
    </header>
    {children}
  </section>
);

/** "dental clinic!" → "dental_clinic": a template key from a name. */
export const keyFromName = (name: string): string => {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40)
    .replace(/_+$/g, "");
  return /^[a-z]/.test(base) ? base : base ? `t_${base}`.slice(0, 40) : "";
};

export const day = (at: string | null): string => (at ? new Date(at).toLocaleDateString() : "");

/** The error code ally-be put on a failed request, if any. */
export const errorCode = (error: unknown): string | undefined => {
  const data = (error as { data?: { errorCode?: string; code?: string } })?.data;
  return data?.errorCode ?? data?.code;
};

/** The problems a refused publish carried. */
export const issuesOfError = (error: unknown): TemplateIssue[] =>
  ((error as { data?: { issues?: TemplateIssue[] } })?.data?.issues ?? []) as TemplateIssue[];
