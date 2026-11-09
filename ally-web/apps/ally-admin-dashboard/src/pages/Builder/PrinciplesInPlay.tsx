import React, { useEffect, useState } from "react";

import { CheckCircle2, CircleDashed, Quote, Scale, type LucideIcon } from "lucide-react";
import { toast } from "sonner";

import { useGetBuilderPrinciplesQuery, useSetBuilderPrinciplesOffMutation } from "@api";
import { en } from "@constants";
import { BuilderPrincipleStatus } from "@types";

import { CitationChip } from "../../components/builder/CitationChip";
import { StatusWord } from "../ContextLibrary/ContextLibraryUi";

/** Polled while the brief is being built: it lands in the background, seconds after start. */
const FINDING_POLL_MS = 4_000;
/** Polled while the session is live: statuses move as the interview cites and applies. */
const LIVE_POLL_MS = 15_000;

const STATUS_ICON: Record<BuilderPrincipleStatus, LucideIcon> = {
  applied: CheckCircle2,
  trade_off: Scale,
  cited: Quote,
  open: CircleDashed,
};

const STATUS_TONE: Record<BuilderPrincipleStatus, "good" | "warning" | "info" | "muted"> = {
  applied: "good",
  trade_off: "warning",
  cited: "info",
  open: "muted",
};

const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500";

/**
 * Principles in play for one Builder session: what the interview is being guided by, each with
 * its status (from usage — nobody grades them), the trade-offs between them, and the
 * per-session switch. Compact and foldable: it sits above the PRD, which is the work itself.
 */
export const PrinciplesInPlay: React.FC<{ sessionId: string; live: boolean }> = ({
  sessionId,
  live,
}) => {
  const strings = en.builder.principles;
  const [finding, setFinding] = useState(false);
  const { data, isLoading, isError, refetch } = useGetBuilderPrinciplesQuery(sessionId, {
    skip: !sessionId,
    pollingInterval: finding ? FINDING_POLL_MS : live ? LIVE_POLL_MS : 0,
  });
  const [setOff, { isLoading: switching }] = useSetBuilderPrinciplesOffMutation();
  // Flipped here ahead of the server; dropped when it answers.
  const [offDraft, setOffDraft] = useState<boolean | null>(null);
  useEffect(() => setOffDraft(null), [data]);

  const off = offDraft ?? Boolean(data?.off);
  const items = data?.items ?? [];
  const isFinding = Boolean(data && data.enabled && !off && !data.briefReady && !items.length);
  useEffect(() => setFinding(isFinding), [isFinding]);

  const flip = async () => {
    const next = !off;
    setOffDraft(next);
    try {
      await setOff({ id: sessionId, off: next }).unwrap();
      toast(next ? strings.turnedOff : strings.turnedOn);
    } catch {
      setOffDraft(null);
      toast.error(strings.failed);
    }
  };

  const meta = off ? strings.offWord : items.length ? strings.count(items.length) : null;

  const body = () => {
    if (isLoading) return null;
    if (isError || !data) {
      return (
        <p className="flex flex-wrap items-center gap-2 text-xs text-red-700" role="alert">
          {strings.loadFailed}
          <button
            type="button"
            onClick={() => void refetch()}
            className={`rounded underline ${focusRing}`}
          >
            {strings.retry}
          </button>
        </p>
      );
    }
    if (off) return <p className="text-xs text-typography-600">{strings.off}</p>;
    if (!data.enabled) return <p className="text-xs text-typography-600">{strings.unavailable}</p>;
    if (isFinding) {
      return (
        <p
          className="flex items-center gap-2 text-xs text-typography-600"
          role="status"
          data-testid="principles-finding"
        >
          <span
            aria-hidden
            className="inline-block h-1.5 w-1.5 rounded-full bg-primary-500 motion-safe:animate-pulse"
          />
          {strings.finding}
        </p>
      );
    }
    if (!items.length) return <p className="text-xs text-typography-600">{strings.none}</p>;
    return (
      <div className="space-y-3">
        {data.descriptor && (
          <p className="text-xs text-typography-500">{strings.readAs(data.descriptor)}</p>
        )}
        <ul className="space-y-2" aria-label={strings.heading}>
          {items.map(item => (
            <li key={item.code} className="text-sm" data-testid="principle-item">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <CitationChip code={item.code} />
                <StatusWord
                  icon={STATUS_ICON[item.status] ?? CircleDashed}
                  tone={STATUS_TONE[item.status] ?? "muted"}
                  label={strings.status[item.status] ?? item.status}
                  testId="principle-status"
                />
                {item.inBrief && (
                  <span className="text-xs text-typography-500">{strings.inBrief}</span>
                )}
              </div>
              <p className="mt-0.5 text-typography-900">{item.statement}</p>
              {item.probe && <p className="text-xs italic text-typography-600">{item.probe}</p>}
            </li>
          ))}
        </ul>
        {data.tensions?.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-typography-600">{strings.tensionsHeading}</p>
            <ul className="mt-1 space-y-1">
              {data.tensions.map(t => (
                <li key={`${t.a}-${t.b}`} className="text-xs text-typography-700">
                  <span className="inline-flex items-center gap-1">
                    <Scale size={12} aria-hidden className="text-amber-700" />
                    {strings.tension(t.a, t.b)}
                  </span>
                  {t.note && <span className="block text-typography-600">{t.note}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  };

  return (
    <details
      open
      className="group shrink-0 border-b border-neutral-200"
      data-testid="principles-in-play"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-2 hover:bg-neutral-50">
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block text-typography-400 transition-transform group-open:rotate-90 motion-reduce:transition-none"
          >
            ›
          </span>
          <span className="text-xs font-semibold tracking-wide text-typography-600">
            {strings.heading}
          </span>
        </span>
        {meta && <span className="text-xs text-typography-500">{meta}</span>}
      </summary>
      <div className="max-h-72 space-y-3 overflow-y-auto px-4 pb-3">
        {data && (
          <button
            type="button"
            role="switch"
            aria-checked={!off}
            aria-label={strings.switchLabel}
            disabled={switching}
            onClick={() => void flip()}
            className={`inline-flex items-center gap-2 rounded py-1 text-xs text-typography-700 disabled:opacity-60 ${focusRing}`}
            data-testid="principles-switch"
          >
            <span
              aria-hidden
              className={`relative inline-block h-4 w-7 rounded-full transition-colors motion-reduce:transition-none ${
                off ? "bg-neutral-300" : "bg-green-600"
              }`}
            >
              <span
                className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all motion-reduce:transition-none ${
                  off ? "left-0.5" : "left-3.5"
                }`}
              />
            </span>
            {strings.switchLabel}: {off ? strings.offWord : strings.on}
          </button>
        )}
        {body()}
      </div>
    </details>
  );
};
