import { FC, KeyboardEvent, useEffect, useRef, useState } from "react";

import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { Button, InlineLoading, Tag, Tooltip } from "@ally-ui-mono/ui-shared";
import {
  useBulkBugHunterV2BugsMutation,
  useDismissBugHunterV2BugMutation,
  useGetBugHunterV2BugsQuery,
  useGetBugHunterV2SettingsQuery,
  useMergeBugHunterV2PrMutation,
  useOpenBugHunterV2PrMutation,
  useReleaseBugHunterV2BugMutation,
  useSetBugHunterV2ModeMutation,
  useStartBugHunterV2BugMutation,
} from "@api";
import { TooltipIcon } from "@assets";
import { en, ROUTES } from "@constants";
import {
  BugFindingSource,
  BugFindingStatus,
  BugHunterV2Bug,
  BugHunterV2DismissReason,
  BugHunterV2Mode,
  BugHunterV2Tab,
} from "@types";
import { formatRelativeTime } from "@utils";

import {
  BUG_FINDING_SOURCE_LABELS,
  BUG_FINDING_STATUS_LABELS,
} from "../BugHunter/bugFindingLabels";

const MODES: BugHunterV2Mode[] = ["off", "manual", "autonomous"];
/** The old Bug Hunter's tab order: what needs a human first. */
export const BOARD_TABS: BugHunterV2Tab[] = [
  "needs_you",
  "failed",
  "in_progress",
  "backlog",
  "done",
];
const APPS = ["ally-be", "ally-web", "ally-ai", "ally-ai-learn", "ally-mobile"];
/** Only the tabs whose next move is a human's get a coloured count, as on the old board. */
const OCCUPIED: Partial<Record<BugHunterV2Tab, string>> = {
  needs_you: "bg-orange-100 text-orange-800",
  failed: "bg-destructive-100 text-destructive-700",
};
const POLL_MS = 15000;

const fill = (text: string, values: Record<string, string | number>) =>
  Object.entries(values).reduce((t, [k, v]) => t.replace(`{${k}}`, String(v)), text);

type TagColour = "green" | "purple" | "red" | "blue" | "gray" | "cyan";

/** A v1 row's status is v1's own; its colour follows the tab it sits under. */
const TAB_TAG: Record<BugHunterV2Tab, TagColour> = {
  needs_you: "purple",
  failed: "red",
  in_progress: "blue",
  backlog: "gray",
  done: "green",
};

const sourceLabel = (b: BugHunterV2Bug, sources: Record<string, string>) =>
  b.origin === "v1"
    ? (BUG_FINDING_SOURCE_LABELS[b.source.replace(/^v1:/, "") as BugFindingSource] ??
      b.source.replace(/^v1:/, ""))
    : (sources[b.source] ?? b.source);

const statusLabel = (b: BugHunterV2Bug, statuses: Record<string, string>) =>
  b.origin === "v1"
    ? (BUG_FINDING_STATUS_LABELS[b.status as BugFindingStatus] ?? b.status)
    : (statuses[b.status] ?? b.status);

const rowKey = (b: BugHunterV2Bug) => (b.origin === "v1" ? `v1-${b.v1FindingId}` : `v2-${b.id}`);

const STATUS_TAG: Record<string, TagColour> = {
  backlog: "gray",
  queued: "cyan",
  running: "blue",
  needs_you: "purple",
  pr_open: "blue",
  merged: "green",
  released: "green",
  failed: "red",
  done: "green",
};

const DISMISS_REASONS: BugHunterV2DismissReason[] = [
  "not_a_bug",
  "duplicate",
  "wont_fix",
  "wrong_diagnosis",
];
/** Rows a bulk Put me on / Dismiss may take, as on the old board. */
const SELECTABLE = ["backlog", "failed", "needs_you"];
const selectable = (b: BugHunterV2Bug) =>
  b.origin === "v2" && b.id !== null && SELECTABLE.includes(b.status);

const errorText = (error: unknown) =>
  (error as { data?: { message?: string } })?.data?.message ?? "";

/**
 * Bug Hunter v2's board (chunk 10), shaped like the old Bug Hunter's: the mode
 * (Off / Manual / Autonomous) and five tabs over every bug. A row with a report opens
 * it (finding, failing test, patch, verdict). Gated by the route
 * (`bug_hunter_v2_verdicts`) and by ally-be, which 403s without it.
 */
export const BugHunterV2Board: FC = () => {
  const strings = en.bugHunterV2.board;
  const [tab, setTab] = useState<BugHunterV2Tab | null>(null);
  const settings = useGetBugHunterV2SettingsQuery(undefined, { pollingInterval: POLL_MS });
  const board = useGetBugHunterV2BugsQuery(
    { tab: tab ?? "needs_you" },
    { pollingInterval: POLL_MS },
  );
  const unavailable =
    (board.error as { status?: number } | undefined)?.status === 503 ||
    (settings.error as { status?: number } | undefined)?.status === 503;

  // Open on the first tab with something in it, like the old board's default bucket.
  useEffect(() => {
    if (tab !== null || !board.data) return;
    const first = BOARD_TABS.find(t => board.data!.counts[t] > 0);
    if (first && first !== "needs_you") setTab(first);
    else setTab("needs_you");
  }, [board.data, tab]);

  return (
    <div className="flex flex-col gap-4 p-6" data-testid="bug-hunter-v2-board">
      <div>
        <h1 className="text-xl font-semibold text-typography-900">{strings.title}</h1>
        <p className="mt-1 max-w-3xl text-sm text-typography-600">{strings.intro}</p>
      </div>
      {unavailable && (
        <p className="text-sm text-support-error" role="alert">
          {en.bugHunterV2.unavailable}
        </p>
      )}
      {settings.data && (
        <ModeSwitch
          mode={settings.data.mode}
          dailyRunLimit={settings.data.dailyRunLimit}
          startedToday={settings.data.startedToday}
        />
      )}
      {board.data && (
        <BoardTabs counts={board.data.counts} value={tab ?? "needs_you"} onChange={setTab} />
      )}
      <div id="bug-hunter-v2-panel" role="tabpanel">
        {board.isLoading && <InlineLoading />}
        {board.isError && !unavailable && (
          <p className="text-sm text-support-error" role="alert">
            {en.bugHunterV2.loadError}
          </p>
        )}
        {board.data && board.data.items.length === 0 && (
          <p className="text-sm text-typography-500">{strings.empty[tab ?? "needs_you"]}</p>
        )}
        {board.data && board.data.items.length > 0 && (
          <BugTable bugs={board.data.items} modeOff={settings.data?.mode === "off"} />
        )}
      </div>
    </div>
  );
};

const ModeSwitch: FC<{
  mode: BugHunterV2Mode;
  dailyRunLimit: number;
  startedToday: number;
}> = ({ mode, dailyRunLimit, startedToday }) => {
  const strings = en.bugHunterV2.board;
  const [setMode, { isLoading }] = useSetBugHunterV2ModeMutation();
  const [confirming, setConfirming] = useState(false);

  const apply = async (next: BugHunterV2Mode) => {
    setConfirming(false);
    try {
      await setMode(next).unwrap();
      toast.success(fill(strings.modeSaved, { mode: strings.modes[next] }));
    } catch {
      toast.error(strings.modeError);
    }
  };
  const choose = (next: BugHunterV2Mode) => {
    if (next === mode || isLoading) return;
    if (next === "autonomous") setConfirming(true);
    else void apply(next);
  };

  return (
    <div className="flex flex-col gap-2 rounded border border-neutral-200 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-1 text-sm font-medium text-typography-800">
          {strings.modeLabel}
          <Tooltip label={strings.modeTooltip} align="top">
            <button type="button" className="inline-flex cursor-pointer items-center">
              <TooltipIcon />
            </button>
          </Tooltip>
        </span>
        <div className="flex" role="radiogroup" aria-label={strings.modeLabel}>
          {MODES.map(m => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              disabled={isLoading}
              onClick={() => choose(m)}
              className={`border px-4 py-1.5 text-sm first:rounded-l last:rounded-r ${
                mode === m
                  ? "border-primary-500 bg-primary-50 font-medium text-primary-700"
                  : "border-neutral-200 text-typography-600 hover:bg-neutral-50"
              }`}
            >
              {strings.modes[m]}
            </button>
          ))}
        </div>
        <span className="text-xs text-typography-500">
          {fill(strings.todayRuns, { started: startedToday, limit: dailyRunLimit })}
        </span>
      </div>
      <p className="text-sm text-typography-600">{strings.modeHelp[mode]}</p>
      {confirming && (
        <div
          className="flex flex-wrap items-center gap-3 rounded bg-orange-50 p-3 text-sm text-orange-900"
          role="alertdialog"
        >
          <span>{fill(strings.confirmAutonomous, { limit: dailyRunLimit })}</span>
          <Button kind="primary" size="sm" onClick={() => void apply("autonomous")}>
            {strings.confirm}
          </Button>
          <Button kind="ghost" size="sm" onClick={() => setConfirming(false)}>
            {strings.cancel}
          </Button>
        </div>
      )}
    </div>
  );
};

const BoardTabs: FC<{
  counts: Record<BugHunterV2Tab, number>;
  value: BugHunterV2Tab;
  onChange: (tab: BugHunterV2Tab) => void;
}> = ({ counts, value, onChange }) => {
  const strings = en.bugHunterV2.board;
  const refs = useRef<Partial<Record<BugHunterV2Tab, HTMLButtonElement | null>>>({});
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const i = BOARD_TABS.indexOf(value);
    const next =
      event.key === "ArrowRight"
        ? (i + 1) % BOARD_TABS.length
        : event.key === "ArrowLeft"
          ? (i - 1 + BOARD_TABS.length) % BOARD_TABS.length
          : null;
    if (next === null) return;
    event.preventDefault();
    onChange(BOARD_TABS[next]);
    refs.current[BOARD_TABS[next]]?.focus();
  };
  return (
    <div className="flex gap-1 border-b border-neutral-200" role="tablist">
      {BOARD_TABS.map(t => {
        const n = counts[t] ?? 0;
        const pill = n > 0 && OCCUPIED[t] ? OCCUPIED[t] : "bg-neutral-100 text-typography-700";
        return (
          <button
            key={t}
            ref={el => (refs.current[t] = el)}
            type="button"
            role="tab"
            aria-selected={value === t}
            aria-controls="bug-hunter-v2-panel"
            tabIndex={value === t ? 0 : -1}
            onKeyDown={onKeyDown}
            onClick={() => onChange(t)}
            className={`-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm ${
              value === t
                ? "border-primary-500 font-medium text-typography-900"
                : "border-transparent text-typography-600 hover:text-typography-800"
            }`}
          >
            {strings.tabs[t]}
            <span className={`rounded-full px-2 text-xs ${pill}`}>{n}</span>
          </button>
        );
      })}
    </div>
  );
};

const BugTable: FC<{ bugs: BugHunterV2Bug[]; modeOff: boolean }> = ({ bugs, modeOff }) => {
  const strings = en.bugHunterV2.board;
  const navigate = useNavigate();
  const [selected, setSelected] = useState<number[]>([]);
  const choosable = bugs.filter(selectable).map(b => b.id as number);
  // keep only what is still on this page and still selectable
  const chosen = selected.filter(id => choosable.includes(id));
  const toggle = (id: number) =>
    setSelected(s => (s.includes(id) ? s.filter(x => x !== id) : [...s, id]));
  const allChosen = choosable.length > 0 && chosen.length === choosable.length;
  return (
    <div className="flex flex-col gap-2">
      {chosen.length > 0 && <BulkBar ids={chosen} onDone={() => setSelected([])} />}
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-neutral-200 text-left text-typography-500">
            <th className="w-8 py-2 pr-2">
              {choosable.length > 0 && (
                <input
                  type="checkbox"
                  aria-label={strings.selectAll}
                  checked={allChosen}
                  onChange={() => setSelected(allChosen ? [] : choosable)}
                />
              )}
            </th>
            <th className="py-2 pr-3 font-medium">{strings.columns.bug}</th>
            <th className="py-2 pr-3 font-medium">{strings.columns.source}</th>
            <th className="py-2 pr-3 font-medium">{strings.columns.app}</th>
            <th className="py-2 pr-3 font-medium">{strings.columns.status}</th>
            <th className="py-2 pr-3 font-medium">{strings.columns.age}</th>
            <th className="py-2 font-medium">{strings.columns.action}</th>
          </tr>
        </thead>
        <tbody>
          {bugs.map(b => {
            // A v2 row opens its report; a v1 row opens read-only here, never the old page.
            const target =
              b.origin === "v1"
                ? ROUTES.BUG_HUNTER_V2_V1_BUG(b.v1FindingId ?? "")
                : b.reportId !== null
                  ? ROUTES.BUG_HUNTER_V2_REPORT(b.reportId)
                  : null;
            return (
              <tr
                key={rowKey(b)}
                data-testid={`bug-row-${rowKey(b)}`}
                className={`border-b border-neutral-100 align-top ${
                  target ? "cursor-pointer hover:bg-neutral-50" : ""
                }`}
                onClick={() => target && navigate(target)}
              >
                <td className="py-2 pr-2" onClick={e => e.stopPropagation()}>
                  {selectable(b) && (
                    <input
                      type="checkbox"
                      aria-label={fill(strings.selectRow, { title: b.title })}
                      checked={chosen.includes(b.id as number)}
                      onChange={() => toggle(b.id as number)}
                    />
                  )}
                </td>
                <td className="py-2 pr-3">
                  <div className="font-medium text-typography-900">{b.title}</div>
                  {b.reason && <div className="mt-0.5 text-xs text-typography-500">{b.reason}</div>}
                  {b.status === "queued" && modeOff && (
                    <div className="mt-0.5 text-xs text-orange-700">{strings.offHint}</div>
                  )}
                  {b.lastAction?.status === "failed" && !b.prUrl && (
                    <div className="mt-0.5 text-xs text-support-error">
                      {fill(strings.openPrFailed, { why: b.lastAction.result ?? "" })}
                    </div>
                  )}
                </td>
                <td className="py-2 pr-3">
                  <div className="flex items-center gap-1.5">
                    {sourceLabel(b, strings.sources)}
                    {b.origin === "v1" && (
                      <Tooltip label={strings.v1Help} align="top">
                        <Tag type="outline" size="sm">
                          {strings.v1Badge}
                        </Tag>
                      </Tooltip>
                    )}
                  </div>
                </td>
                <td className="py-2 pr-3">{b.app ?? strings.noApp}</td>
                <td className="py-2 pr-3">
                  <Tag
                    type={b.origin === "v1" ? TAB_TAG[b.tab] : (STATUS_TAG[b.status] ?? "gray")}
                    size="sm"
                  >
                    {statusLabel(b, strings.statuses)}
                  </Tag>
                  {b.status === "running" && b.startedAt && (
                    <div className="mt-0.5 text-xs text-typography-500">
                      {fill(strings.runningSince, { time: formatRelativeTime(b.startedAt) })}
                    </div>
                  )}
                  {b.status === "queued" && !modeOff && (
                    <div className="mt-0.5 text-xs text-typography-500">{strings.queuedHint}</div>
                  )}
                  {b.status === "released" && b.releaseTag && (
                    <div className="mt-0.5 text-xs text-typography-500">
                      {fill(strings.releasedAs, { tag: b.releaseTag })}
                    </div>
                  )}
                </td>
                <td className="py-2 pr-3 text-typography-500">{formatRelativeTime(b.createdAt)}</td>
                <td className="py-2" onClick={e => e.stopPropagation()}>
                  <RowActions bug={b} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

/** Put me on / Dismiss for every selected bug; each one's result is counted. */
const BulkBar: FC<{ ids: number[]; onDone: () => void }> = ({ ids, onDone }) => {
  const strings = en.bugHunterV2.board;
  const [bulk, { isLoading }] = useBulkBugHunterV2BugsMutation();
  const [reason, setReason] = useState<BugHunterV2DismissReason | "">("");
  const run = async (action: "start" | "dismiss") => {
    try {
      const out = await bulk({
        action,
        ids,
        reason: action === "dismiss" ? (reason as BugHunterV2DismissReason) : undefined,
      }).unwrap();
      toast.success(fill(strings.bulkDone, { done: out.done, total: ids.length }));
      onDone();
    } catch {
      toast.error(strings.bulkError);
    }
  };
  return (
    <div
      className="flex flex-wrap items-center gap-3 rounded bg-neutral-50 p-2 text-sm"
      role="region"
      aria-label={fill(strings.bulkSelected, { count: ids.length })}
    >
      <span className="font-medium">{fill(strings.bulkSelected, { count: ids.length })}</span>
      <Button kind="primary" size="sm" disabled={isLoading} onClick={() => void run("start")}>
        {fill(strings.bulkStart, { count: ids.length })}
      </Button>
      <select
        aria-label={strings.dismissTitle}
        value={reason}
        onChange={e => setReason(e.target.value as BugHunterV2DismissReason)}
        className="rounded border border-neutral-300 px-2 py-1"
      >
        <option value="">{strings.dismissTitle}</option>
        {DISMISS_REASONS.map(r => (
          <option key={r} value={r}>
            {strings.dismissReasons[r]}
          </option>
        ))}
      </select>
      <Button
        kind="secondary"
        size="sm"
        disabled={isLoading || !reason}
        onClick={() => void run("dismiss")}
      >
        {fill(strings.bulkDismiss, { count: ids.length })}
      </Button>
      <Button kind="ghost" size="sm" onClick={onDone}>
        {strings.clearSelection}
      </Button>
    </div>
  );
};

/** The old Bug Hunter's buttons, by state: Put me on it, Open PR, View PR, Merge, Release, Dismiss. */
const RowActions: FC<{ bug: BugHunterV2Bug }> = ({ bug }) => {
  const strings = en.bugHunterV2.board;
  const [openPr, opening] = useOpenBugHunterV2PrMutation();
  const [merge, merging] = useMergeBugHunterV2PrMutation();
  const [release, releasing] = useReleaseBugHunterV2BugMutation();
  const [dismissing, setDismissing] = useState(false);
  // v1 rows are the old Bug Hunter's to run; v2 only shows them.
  if (bug.origin !== "v2" || bug.id === null) return null;
  const id = bug.id;
  const pendingPr = bug.lastAction?.status === "pending";
  const canOpenPr =
    bug.status === "needs_you" && bug.reportStatus === "suggested_fix" && !bug.prUrl;
  const canDismiss = ["backlog", "needs_you", "failed", "pr_open"].includes(bug.status);

  const act = async (
    call: () => Promise<unknown>,
    ok: string | null,
    fail: string,
    confirmText?: string,
  ) => {
    if (confirmText && !window.confirm(confirmText)) return;
    try {
      await call();
      if (ok) toast.success(ok);
    } catch (error) {
      toast.error(fill(fail, { why: errorText(error) }));
    }
  };

  if (dismissing) return <DismissForm id={id} onClose={() => setDismissing(false)} />;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <StartAction bug={bug} />
      {canOpenPr && !pendingPr && (
        <Button
          kind="primary"
          size="sm"
          title={strings.openPrHelp}
          disabled={opening.isLoading}
          onClick={() => void act(() => openPr(id).unwrap(), null, strings.openPrError)}
        >
          {strings.openPr}
        </Button>
      )}
      {canOpenPr && pendingPr && (
        <span className="text-xs text-typography-500">{strings.openingPr}</span>
      )}
      {bug.prUrl && (
        <a
          href={bug.prUrl}
          target="_blank"
          rel="noreferrer"
          className="text-sm text-primary-600 underline"
        >
          {strings.viewPr}
        </a>
      )}
      {bug.status === "pr_open" && (
        <Button
          kind="primary"
          size="sm"
          disabled={merging.isLoading}
          onClick={() =>
            void act(
              () => merge(id).unwrap(),
              strings.merged,
              strings.mergeError,
              strings.mergeConfirm,
            )
          }
        >
          {strings.merge}
        </Button>
      )}
      {bug.status === "merged" && (
        <Button
          kind="primary"
          size="sm"
          disabled={releasing.isLoading}
          onClick={() =>
            void act(() => release(id).unwrap(), null, strings.releaseError, strings.releaseConfirm)
          }
        >
          {strings.release}
        </Button>
      )}
      {canDismiss && (
        <Button kind="ghost" size="sm" onClick={() => setDismissing(true)}>
          {strings.dismiss}
        </Button>
      )}
    </div>
  );
};

const DismissForm: FC<{ id: number; onClose: () => void }> = ({ id, onClose }) => {
  const strings = en.bugHunterV2.board;
  const [dismiss, { isLoading }] = useDismissBugHunterV2BugMutation();
  const [reason, setReason] = useState<BugHunterV2DismissReason | "">("");
  const [note, setNote] = useState("");
  const go = async () => {
    try {
      await dismiss({
        id,
        reason: reason as BugHunterV2DismissReason,
        note: note.trim() || undefined,
      }).unwrap();
      toast.success(strings.dismissed);
      onClose();
    } catch {
      toast.error(strings.dismissError);
    }
  };
  return (
    <div className="flex flex-col gap-2" role="group" aria-label={strings.dismiss}>
      <select
        aria-label={strings.dismissTitle}
        value={reason}
        onChange={e => setReason(e.target.value as BugHunterV2DismissReason)}
        className="rounded border border-neutral-300 px-2 py-1 text-sm"
      >
        <option value="">{strings.dismissTitle}</option>
        {DISMISS_REASONS.map(r => (
          <option key={r} value={r}>
            {strings.dismissReasons[r]}
          </option>
        ))}
      </select>
      <input
        aria-label={strings.dismissNote}
        placeholder={strings.dismissNote}
        value={note}
        onChange={e => setNote(e.target.value)}
        maxLength={1000}
        className="rounded border border-neutral-300 px-2 py-1 text-sm"
      />
      <div className="flex gap-2">
        <Button
          kind="secondary"
          size="sm"
          disabled={!reason || isLoading}
          onClick={() => void go()}
        >
          {strings.dismissConfirm}
        </Button>
        <Button kind="ghost" size="sm" onClick={onClose}>
          {strings.cancel}
        </Button>
      </div>
    </div>
  );
};

/** Start fix (Backlog) or Retry (Failed). A reported bug with no app needs one picked. */
const StartAction: FC<{ bug: BugHunterV2Bug }> = ({ bug }) => {
  const strings = en.bugHunterV2.board;
  const [start, { isLoading }] = useStartBugHunterV2BugMutation();
  const [app, setApp] = useState("");
  // v1 rows are the old Bug Hunter's to run; v2 only shows them.
  if (bug.origin !== "v2" || bug.id === null) return null;
  if (bug.status !== "backlog" && bug.status !== "failed") return null;
  const needsApp = !bug.app;
  const go = async () => {
    try {
      await start({ id: bug.id!, app: needsApp ? app : undefined }).unwrap();
    } catch {
      toast.error(strings.startError);
    }
  };
  return (
    <div className="flex items-center gap-2">
      {needsApp && (
        <select
          aria-label={strings.pickApp}
          title={strings.pickAppHelp}
          value={app}
          onChange={e => setApp(e.target.value)}
          className="rounded border border-neutral-300 px-2 py-1 text-sm"
        >
          <option value="">{strings.pickApp}</option>
          {APPS.map(a => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      )}
      <Button
        kind={bug.status === "failed" ? "secondary" : "primary"}
        size="sm"
        disabled={isLoading || (needsApp && !app)}
        onClick={() => void go()}
      >
        {bug.status === "failed" ? strings.retry : strings.startFix}
      </Button>
    </div>
  );
};

export default BugHunterV2Board;
