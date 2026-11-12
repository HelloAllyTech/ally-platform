import React from "react";

import { Link } from "react-router-dom";

/**
 * Small pieces the Debriefs pages share. Colours are Carbon's (White theme) through the admin's
 * Tailwind tokens; Carbon orange has no Tailwind token, so it is written as the hex.
 */

/** A banner in Carbon's inline-notification style: red = act now, yellow = act soon. */
export const AlertBanner: React.FC<{
  kind: "error" | "warning";
  children: React.ReactNode;
  action?: React.ReactNode;
  testId?: string;
}> = ({ kind, children, action, testId }) => (
  <div
    role={kind === "error" ? "alert" : "status"}
    data-testid={testId}
    className={[
      "flex flex-wrap items-center gap-x-4 gap-y-2 border-l-[3px] px-4 py-3 text-sm",
      kind === "error"
        ? "border-destructive-500 bg-destructive-50"
        : "border-warning-200 bg-warning-50",
    ].join(" ")}
  >
    <span
      aria-hidden="true"
      className={[
        "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold",
        kind === "error" ? "bg-destructive-500 text-white" : "bg-warning-200 text-neutral-900",
      ].join(" ")}
    >
      !
    </span>
    <div className="min-w-[16rem] flex-1 text-typography-900">{children}</div>
    {action}
  </div>
);

/** The outlined "back" link the PM agent, Settings and session pages open with. */
export const BackLink: React.FC<{ to: string; children: React.ReactNode }> = ({ to, children }) => (
  <Link
    to={to}
    className="inline-flex h-9 items-center gap-1.5 rounded-sm border border-primary-500 px-2.5 text-sm text-primary-500 no-underline hover:text-primary-600"
  >
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.6" />
    </svg>
    {children}
  </Link>
);

export type TagTone = "neutral" | "info" | "success" | "warning" | "danger" | "urgent" | "flag";

const TAG: Record<TagTone, string> = {
  neutral: "bg-neutral-100 text-neutral-900",
  info: "bg-primary-50 text-primary-700",
  success: "bg-success-50 text-success-600",
  warning: "bg-[#FFF2E8] text-[#8A3800]",
  danger: "bg-destructive-100 text-destructive-600",
  urgent: "bg-destructive-500 text-white",
  flag: "bg-destructive-100 text-destructive-600",
};

/** A Carbon-coloured tag as a span: cards are links, and a Carbon Tag is a button. */
export const ConsoleTag: React.FC<{
  tone?: TagTone;
  children: React.ReactNode;
  title?: string;
  testId?: string;
}> = ({ tone = "neutral", children, title, testId }) => (
  <span
    title={title}
    data-testid={testId}
    className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${TAG[tone]}`}
  >
    {children}
  </span>
);

/** The house segmented switcher (category picker, Debrief column tabs). */
export function Segmented<T extends string>({
  items,
  value,
  onChange,
  label,
  role = "group",
}: {
  items: Array<{ id: T; label: React.ReactNode }>;
  value: T;
  onChange: (id: T) => void;
  label: string;
  role?: "group" | "tablist";
}) {
  return (
    <div
      role={role}
      aria-label={label}
      className="inline-flex flex-wrap gap-1 rounded-sm bg-neutral-100 p-1"
    >
      {items.map(item => {
        const on = item.id === value;
        return (
          <button
            key={item.id}
            type="button"
            role={role === "tablist" ? "tab" : undefined}
            aria-selected={role === "tablist" ? on : undefined}
            aria-pressed={role === "group" ? on : undefined}
            onClick={() => onChange(item.id)}
            className={[
              "inline-flex h-9 items-center gap-2 rounded-sm px-3.5 text-sm",
              on
                ? "bg-neutral-900 font-semibold text-white"
                : "bg-transparent font-medium text-neutral-700",
            ].join(" ")}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

/** A grey tile: the house `#F4F4F4` surface with 2px corners. */
export const Tile: React.FC<{
  children: React.ReactNode;
  className?: string;
  testId?: string;
  id?: string;
}> = ({ children, className, testId, id }) => (
  <div id={id} data-testid={testId} className={`rounded-sm bg-neutral-50 ${className ?? ""}`}>
    {children}
  </div>
);
