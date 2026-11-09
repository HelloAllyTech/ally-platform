import React, { useEffect, useState } from "react";

import {
  AlertTriangle,
  Archive,
  Bot,
  Building2,
  CircleDot,
  FileText,
  Globe,
  Hourglass,
  Import,
  Merge,
  PenLine,
  Pin,
  RefreshCw,
  UserX,
  type LucideIcon,
} from "lucide-react";

import { SkeletonText } from "@ally-ui-mono/ui-shared";
import { en } from "@constants";
import { ContextChunk } from "@types";

import { audienceLabel, originLabel } from "./contextLibraryFormat";

/**
 * Small pieces the Context Library views share. Every status is an icon AND a word, never
 * colour alone.
 */

export const ORIGIN_ICON: Record<string, LucideIcon> = {
  distilled: FileText,
  authored: PenLine,
  imported: Import,
  agent: Bot,
  synced: RefreshCw,
};

export const StatusWord: React.FC<{
  icon: LucideIcon;
  label: string;
  tone?: "muted" | "warning" | "good" | "info";
  testId?: string;
}> = ({ icon: Icon, label, tone = "muted", testId }) => {
  const toneClass = {
    muted: "text-typography-600",
    warning: "text-amber-700",
    good: "text-green-700",
    info: "text-primary-600",
  }[tone];
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap text-xs ${toneClass}`}
      data-testid={testId}
    >
      <Icon size={12} aria-hidden className="shrink-0" />
      {label}
    </span>
  );
};

export const OriginBadge: React.FC<{ origin: string }> = ({ origin }) => (
  <StatusWord icon={ORIGIN_ICON[origin] ?? CircleDot} label={originLabel(origin)} />
);

/**
 * Who an entry reaches: Global, the viewer's own organisation, a named one, or several. An icon
 * and a word, always (§10.6), so it never rests on colour or shape alone.
 */
export const AudienceBadge: React.FC<{
  chunk: Pick<ContextChunk, "isGlobal" | "tenantIds" | "ownerTenantId">;
  /** The organisation an organisation admin is looking at, if any. */
  ownTenantId?: string;
  orgNames?: Record<string, string>;
}> = ({ chunk, ownTenantId, orgNames }) => {
  const { label, kind } = audienceLabel(chunk, ownTenantId, orgNames);
  const icon = kind === "global" ? Globe : kind === "nobody" ? UserX : Building2;
  return (
    <StatusWord
      icon={icon}
      label={label}
      tone={kind === "nobody" ? "warning" : undefined}
      testId="cl-audience"
    />
  );
};

/** Low confidence, pinned, archived, merged: the words a row carries beyond its origin. */
export const ChunkStatusWords: React.FC<{
  chunk: Pick<ContextChunk, "status" | "confidence" | "pinned">;
  noun: string;
}> = ({ chunk, noun }) => {
  const strings = en.contextLibrary.library;
  return (
    <>
      {chunk.status === "superseded" && (
        <StatusWord icon={Merge} label={strings.mergedInto(noun)} />
      )}
      {chunk.status === "archived" && <StatusWord icon={Archive} label={strings.archived} />}
      {chunk.status === "candidate" && <StatusWord icon={Hourglass} label={strings.candidate} />}
      {chunk.confidence === "low" && (
        <StatusWord icon={AlertTriangle} label={strings.lowConfidence} tone="warning" />
      )}
      {chunk.pinned && <StatusWord icon={Pin} label={strings.pinned} tone="info" />}
    </>
  );
};

/** A toggleable filter chip. `aria-pressed` carries the state, so it never rests on colour. */
export const Chip: React.FC<{
  pressed: boolean;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  testId?: string;
}> = ({ pressed, onClick, children, disabled, testId }) => (
  <button
    type="button"
    aria-pressed={pressed}
    disabled={disabled}
    onClick={onClick}
    data-testid={testId}
    className={[
      "inline-flex min-h-[28px] items-center gap-1 rounded-full border px-3 py-0.5 text-xs transition-colors motion-reduce:transition-none",
      "focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500",
      "disabled:cursor-not-allowed disabled:opacity-50",
      pressed
        ? "border-primary-600 bg-primary-50 font-medium text-primary-700"
        : "border-border-light bg-white text-typography-700 hover:bg-neutral-100",
    ].join(" ")}
  >
    {pressed && <span aria-hidden>✓</span>}
    {children}
  </button>
);

/** Skeleton rows; after three seconds a line says it is still loading. */
export const LoadingRows: React.FC<{ rows?: number }> = ({ rows = 4 }) => {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 3_000);
    return () => clearTimeout(timer);
  }, []);
  return (
    <div aria-busy="true" data-testid="cl-loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="border-b border-border-light py-3">
          <SkeletonText paragraph lineCount={2} />
        </div>
      ))}
      {slow && (
        <p className="py-2 text-sm text-typography-600" role="status">
          {en.contextLibrary.loading.still}
        </p>
      )}
    </div>
  );
};

/** An error in place, with its reason and a retry. */
export const InlineError: React.FC<{ what: string; reason?: string; onRetry: () => void }> = ({
  what,
  reason,
  onRetry,
}) => (
  <div
    role="alert"
    className="flex flex-wrap items-center gap-3 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
  >
    <AlertTriangle size={16} aria-hidden />
    <span className="min-w-0 flex-1">
      {en.contextLibrary.loadFailed(what)}
      {reason ? ` ${reason}` : ""}
    </span>
    <button
      type="button"
      onClick={onRetry}
      className="rounded border border-red-300 bg-white px-3 py-1 font-medium hover:bg-red-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500"
    >
      {en.contextLibrary.retry}
    </button>
  </div>
);

/** A two-or-more option segmented control. */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Array<{ id: T; label: string }>;
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded border border-border-light">
      {options.map(option => (
        <button
          key={option.id}
          type="button"
          aria-pressed={value === option.id}
          onClick={() => onChange(option.id)}
          className={[
            "px-3 py-1 text-sm first:rounded-l last:rounded-r",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500",
            value === option.id
              ? "bg-typography-900 font-medium text-white"
              : "bg-white text-typography-700 hover:bg-neutral-100",
          ].join(" ")}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
