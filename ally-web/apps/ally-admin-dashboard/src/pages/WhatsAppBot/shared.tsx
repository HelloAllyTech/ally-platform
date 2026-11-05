import React from "react";

import { toast } from "sonner";

import { InlineNotification } from "@ally-ui-mono/ui-shared";
import { Button } from "@components";
import { ButtonVariant } from "@components/types";
import { en } from "@constants";
import { WaBusinessNumberStatus } from "@types";
import { formatRelativeTime } from "@utils";

/** ally-be puts the human-readable reason (Meta's own, for the number endpoints) in `data.message`. */
export const errorMessage = (error: unknown, fallback: string): string => {
  const message = (error as { data?: { message?: unknown } } | undefined)?.data?.message;
  if (typeof message === "string" && message) return message;
  if (Array.isArray(message) && typeof message[0] === "string") return message[0];
  return fallback;
};

/** Fill `{name}` placeholders in a copy string. */
export const fill = (text: string, values: Record<string, string | number>): string =>
  text.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match));

/** "3 minutes ago" — for timestamps a person scans, not one they audit. */
export const timeAgo = (iso: string | Date | null | undefined): string =>
  iso ? formatRelativeTime(new Date(iso).toISOString()) : "—";

export const copyToClipboard = async (value: string) => {
  // Clipboard access can be refused (insecure origin, permissions policy); say so rather than
  // leave a button that silently did nothing.
  try {
    await navigator.clipboard.writeText(value);
    toast.success(en.whatsappBot.connection.copied);
  } catch {
    toast.error(en.whatsappBot.connection.copyFailed);
  }
};

/** A value to paste somewhere else, with its Copy button. */
export const CopyField: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex flex-col gap-1">
    <span className="text-sm text-typography-700">{label}</span>
    <div className="flex items-center gap-2">
      <code className="flex-1 min-w-0 break-all text-xs bg-background-100 border border-border-light rounded px-2 py-1.5">
        {value}
      </code>
      <Button variant={ButtonVariant.SECONDARY} onClick={() => void copyToClipboard(value)}>
        {en.whatsappBot.connection.copy}
      </Button>
    </div>
  </div>
);

/** One headline number on an overview. */
export const StatCard: React.FC<{
  label: string;
  value: string | number;
  onClick?: () => void;
}> = ({ label, value, onClick }) => {
  const body = (
    <>
      <span className="text-2xl text-typography-900 tabular-nums">
        {typeof value === "number" ? value.toLocaleString() : value}
      </span>
      <span className="text-xs text-typography-500">{label}</span>
    </>
  );
  const className =
    "flex flex-col gap-1 border border-border-light rounded-md p-4 text-left min-w-0";
  return onClick ? (
    <button type="button" onClick={onClick} className={`${className} hover:bg-neutral-50`}>
      {body}
    </button>
  ) : (
    <div className={className}>{body}</div>
  );
};

type PillTone = "success" | "warning" | "neutral" | "danger";

const PILL_STYLES: Record<PillTone, { dot: string; bg: string }> = {
  success: { dot: "bg-success-400", bg: "bg-success-50" },
  warning: { dot: "bg-warning-400", bg: "bg-warning-50" },
  neutral: { dot: "bg-neutral-400", bg: "bg-neutral-100" },
  danger: { dot: "bg-destructive-400", bg: "bg-destructive-50" },
};

/** A coloured dot and a word — the same shape as StatusBadge, for states it has no entry for. */
export const StatusPill: React.FC<{ tone: PillTone; children: React.ReactNode }> = ({
  tone,
  children,
}) => (
  <span
    className={`inline-flex items-center gap-1 px-2 py-[2px] rounded-full text-xs text-typography-900 ${PILL_STYLES[tone].bg}`}
  >
    <span className={`w-2 h-2 rounded-full ${PILL_STYLES[tone].dot}`} />
    {children}
  </span>
);

/** How an organisation's number reads in a list: connected, half-way, or not there at all. */
export const NumberStatusPill: React.FC<{ status?: WaBusinessNumberStatus | null }> = ({
  status,
}) => {
  const t = en.whatsappBot.scope;
  if (!status) return <StatusPill tone="neutral">{t.statusNoNumber}</StatusPill>;
  if (status === WaBusinessNumberStatus.CONNECTED) {
    return <StatusPill tone="success">{t.statusConnected}</StatusPill>;
  }
  if (status === WaBusinessNumberStatus.ERROR) {
    return <StatusPill tone="danger">{en.whatsappBot.connection.status.error}</StatusPill>;
  }
  return <StatusPill tone="warning">{t.statusSettingUp}</StatusPill>;
};

/** A titled block with the page's usual card border. */
export const Card: React.FC<{
  title?: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, subtitle, action, children }) => (
  <section className="flex flex-col gap-4 border border-border-light rounded-md p-5">
    {(title || action) && (
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          {title && <h3 className="text-base text-typography-900 font-secondary">{title}</h3>}
          {subtitle && <p className="text-sm text-typography-600">{subtitle}</p>}
        </div>
        {action}
      </div>
    )}
    {children}
  </section>
);

/** A load failure with a way out: what went wrong, and one button to try again. */
export const LoadError: React.FC<{ title: string; onRetry: () => void }> = ({ title, onRetry }) => (
  <div className="flex flex-col items-start gap-3">
    <InlineNotification kind="error" title={title} lowContrast hideCloseButton />
    <Button variant={ButtonVariant.SECONDARY} onClick={onRetry}>
      {en.whatsappBot.connection.retry}
    </Button>
  </div>
);
