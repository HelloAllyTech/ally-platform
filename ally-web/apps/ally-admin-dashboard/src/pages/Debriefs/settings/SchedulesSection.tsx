import React, { useState } from "react";

import { toast } from "sonner";

import {
  Button,
  CarbonDropdown as Dropdown,
  CarbonToggle,
  TextInput,
} from "@ally-ui-mono/ui-shared";
import {
  useGetDebriefScheduleRunsQuery,
  useGetDebriefSchedulesQuery,
  useUpdateDebriefScheduleMutation,
} from "@api";
import { formatUsd } from "@components/ally-guide/allyGuideFormat";
import { ConfirmDialog } from "@components/ally-guide/ConfirmDialog";
import { en } from "@constants";
import {
  DebriefScheduleChange,
  DebriefScheduleFrequency,
  DebriefScheduleJob,
  DebriefScheduleRun,
  DebriefScheduleSettings,
} from "@types";
import { getErrorMessage } from "@utils";

import { ConsoleTag } from "../consoleUi";

const IST = "Asia/Kolkata";
const INTERVALS = new Set<DebriefScheduleFrequency>([
  "1min",
  "5min",
  "15min",
  "30min",
  "60min",
  "6h",
]);
/** Runs a month at each frequency (mirrors ally-be RUNS_PER_MONTH), for the spend estimate. */
const RUNS_PER_MONTH: Record<DebriefScheduleFrequency, number> = {
  "1min": 43_200,
  "5min": 8_640,
  "15min": 2_880,
  "30min": 1_440,
  "60min": 720,
  "6h": 120,
  daily: 30,
  weekly: 30 / 7,
  "2weeks": 30 / 14,
  monthly: 1,
};
const GRID =
  "grid min-w-[1100px] grid-cols-[minmax(260px,1.8fr)_170px_120px_110px_minmax(180px,1fr)_140px] gap-3";

const s = () => en.debriefs.settingsPage.schedules;
const jobName = (key: string) => s().jobs[key]?.name ?? s().otherJob;
const freqLabel = (f: string) => s().frequency[f] ?? f;

const istDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: IST }).format(d);
const istTime = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: IST,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
/** "12:35" today, "16 Nov 07:30" another day — India time. */
export const istWhen = (iso: string, now = new Date()): string => {
  const d = new Date(iso);
  if (istDay(d) === istDay(now)) return istTime(d);
  const day = new Intl.DateTimeFormat("en-GB", {
    timeZone: IST,
    day: "numeric",
    month: "short",
  }).format(d);
  return `${day} ${istTime(d)}`;
};

/** The "At" column: "—" for interval jobs, "05:35", "Mon 07:30", "1st 08:30". */
export const atLabel = (x: DebriefScheduleSettings): string => {
  if (INTERVALS.has(x.frequency)) return "—";
  const t = x.time ?? "";
  if (x.frequency === "weekly" || x.frequency === "2weeks")
    return `${s().weekdays[x.weekday ?? 1]} ${t}`;
  if (x.frequency === "monthly") return `${s().dayOfMonth(x.monthDay ?? 1)} ${t}`;
  return t;
};

const changeText = (run: DebriefScheduleRun): string => {
  const c = run.change;
  if (!c) return "";
  const parts: string[] = [];
  if (c.before.frequency !== c.after.frequency)
    parts.push(s().changeParts.often(freqLabel(c.before.frequency), freqLabel(c.after.frequency)));
  if (atLabel(c.before) !== atLabel(c.after) && !INTERVALS.has(c.after.frequency))
    parts.push(s().changeParts.at(atLabel(c.before), atLabel(c.after)));
  if (c.before.enabled !== c.after.enabled)
    parts.push(
      s().changeParts.on(c.before.enabled ? s().on : s().off, c.after.enabled ? s().on : s().off),
    );
  return parts.join(" · ");
};

const RESULT_TONE: Record<string, string> = {
  ok: "text-success-600",
  failed: "text-danger-600",
  running: "text-neutral-700",
};

type Pending = { job: DebriefScheduleJob; change: DebriefScheduleChange };

const TimeDialog: React.FC<{
  job: DebriefScheduleJob | null;
  saving: boolean;
  onSave: (change: DebriefScheduleChange) => void;
  onClose: () => void;
}> = ({ job, saving, onSave, onClose }) => {
  const [time, setTime] = useState(job?.time ?? "");
  const [weekday, setWeekday] = useState(job?.weekday ?? 1);
  const [monthDay, setMonthDay] = useState(job?.monthDay ?? 1);
  if (!job) return null;
  const valid = /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
  const weekly = job.frequency === "weekly" || job.frequency === "2weeks";
  const days = s().weekdays.map((label, id) => ({ id, label }));
  const monthDays = Array.from({ length: 28 }, (_, i) => ({ id: i + 1, label: String(i + 1) }));
  return (
    <ConfirmDialog
      isOpen
      title={s().timeTitle(jobName(job.key))}
      cancelLabel={s().cancel}
      confirmLabel={s().save}
      confirmDisabled={!valid}
      isWorking={saving}
      onClose={onClose}
      onConfirm={() =>
        onSave({
          key: job.key,
          time,
          ...(weekly ? { weekday } : {}),
          ...(job.frequency === "monthly" ? { monthDay } : {}),
        })
      }
    >
      <div className="flex flex-col gap-3 pb-3">
        {weekly && (
          <Dropdown
            id="schedule-weekday"
            titleText={s().weekdayLabel}
            label={s().weekdayLabel}
            items={days}
            selectedItem={days[weekday]}
            itemToString={(i: { id: number; label: string } | null) => i?.label ?? ""}
            onChange={({ selectedItem }: { selectedItem: { id: number; label: string } | null }) =>
              selectedItem && setWeekday(selectedItem.id)
            }
          />
        )}
        {job.frequency === "monthly" && (
          <Dropdown
            id="schedule-month-day"
            titleText={s().monthDayLabel}
            label={s().monthDayLabel}
            items={monthDays}
            selectedItem={monthDays[monthDay - 1]}
            itemToString={(i: { id: number; label: string } | null) => i?.label ?? ""}
            onChange={({ selectedItem }: { selectedItem: { id: number; label: string } | null }) =>
              selectedItem && setMonthDay(selectedItem.id)
            }
          />
        )}
        <TextInput
          id="schedule-time"
          labelText={s().timeLabel}
          value={time}
          maxLength={5}
          invalid={time.length > 0 && !valid}
          invalidText={s().timeInvalid}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTime(e.target.value)}
        />
      </div>
    </ConfirmDialog>
  );
};

const RunHistory: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const q = useGetDebriefScheduleRunsQuery({ page }, { skip: !open });
  const data = q.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  return (
    <details
      className="rounded-sm bg-neutral-50 px-4 py-3 text-sm"
      data-testid="schedule-history"
      onToggle={e => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="cursor-pointer font-semibold">{s().history}</summary>
      <p className="mt-2 text-[13px] text-neutral-700">{s().historyHelp}</p>
      {open && data && data.runs.length === 0 && (
        <p className="mt-2 text-neutral-600">{s().historyEmpty}</p>
      )}
      {open && data && data.runs.length > 0 && (
        <div className="mt-2 overflow-x-auto">
          <div className="grid min-w-[800px] grid-cols-[130px_minmax(180px,1fr)_80px_90px_minmax(240px,2fr)] gap-3 border-b border-neutral-100 py-2 text-xs text-neutral-600">
            <span>{s().historyColumns.when}</span>
            <span>{s().historyColumns.job}</span>
            <span>{s().historyColumns.took}</span>
            <span>{s().historyColumns.result}</span>
            <span>{s().historyColumns.what}</span>
          </div>
          {data.runs.map(r => (
            <div
              key={r.id}
              data-testid="schedule-history-row"
              className="grid min-w-[800px] grid-cols-[130px_minmax(180px,1fr)_80px_90px_minmax(240px,2fr)] gap-3 border-b border-neutral-100 py-2 text-[13px]"
            >
              <span>{istWhen(r.startedAt)}</span>
              <span>{jobName(r.key)}</span>
              <span>
                {r.durationMs == null ? "—" : s().seconds(Math.round(r.durationMs / 1000))}
              </span>
              <span className={r.trigger === "config_change" ? "" : RESULT_TONE[r.result]}>
                {r.trigger === "config_change" ? s().changed : s().result[r.result]}
              </span>
              <span className="text-neutral-700">
                {r.trigger === "config_change"
                  ? `${changeText(r)} ${s().changedBy(r.by?.name ?? s().someone)}`
                  : (r.error ?? r.summary ?? "")}
              </span>
            </div>
          ))}
          {pages > 1 && (
            <div className="mt-2 flex items-center gap-3">
              <Button kind="ghost" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                {s().previous}
              </Button>
              <span className="text-xs text-neutral-600">{s().page(page, pages)}</span>
              <Button
                kind="ghost"
                size="sm"
                disabled={page >= pages}
                onClick={() => setPage(page + 1)}
              >
                {s().next}
              </Button>
            </div>
          )}
        </div>
      )}
    </details>
  );
};

/**
 * Settings › Schedules (design Schedules.dc.html): when the Debrief agent's and the PM agent's
 * jobs run. Engineering only — the page shows this section only with the `debrief_schedules`
 * toggle, and ally-be answers 403 without it. A frequency or on/off change to a job paid from
 * the learning budget asks to confirm, like a budget change.
 */
export const SchedulesSection: React.FC = () => {
  const q = useGetDebriefSchedulesQuery();
  const [update, updating] = useUpdateDebriefScheduleMutation();
  const [pending, setPending] = useState<Pending | null>(null);
  const [timeJob, setTimeJob] = useState<DebriefScheduleJob | null>(null);
  const save = async (change: DebriefScheduleChange) => {
    try {
      await update(change).unwrap();
      toast.success(s().saved);
      setPending(null);
      setTimeJob(null);
    } catch (e) {
      toast.error(getErrorMessage(e, s().saveFailed));
    }
  };
  const change = (job: DebriefScheduleJob, c: Omit<DebriefScheduleChange, "key">) => {
    const full = { key: job.key, ...c };
    if (job.learningBudget && (c.frequency !== undefined || c.enabled !== undefined))
      setPending({ job, change: full });
    else void save(full);
  };
  if (!q.data)
    return (
      <p className="text-sm text-neutral-600" data-testid="schedules-missing">
        {q.isError ? s().loadFailed : s().loading}
      </p>
    );
  const spend = (() => {
    if (!pending || pending.job.runCostUsd == null) return null;
    const cost = pending.job.runCostUsd;
    const month = (f: DebriefScheduleFrequency, on: boolean) =>
      on ? formatUsd(RUNS_PER_MONTH[f] * cost) : formatUsd(0);
    return s().budgetEstimate(
      month(pending.job.frequency, pending.job.enabled),
      month(
        pending.change.frequency ?? pending.job.frequency,
        pending.change.enabled ?? pending.job.enabled,
      ),
    );
  })();
  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-x-auto rounded-sm bg-neutral-50" data-testid="schedules-table">
        <div className={`${GRID} border-b border-neutral-100 px-4 py-2.5 text-xs text-neutral-600`}>
          <span>{s().columns.job}</span>
          <span>{s().columns.often}</span>
          <span>{s().columns.at}</span>
          <span>{s().columns.on}</span>
          <span>{s().columns.lastRun}</span>
          <span>{s().columns.nextRun}</span>
        </div>
        {q.data.jobs.map(job => {
          const name = jobName(job.key);
          const items = job.options.map(id => ({ id, label: freqLabel(id) }));
          const last = job.lastRun;
          return (
            <div
              key={job.key}
              data-testid="schedule-row"
              className={`${GRID} items-center border-b border-neutral-100 px-4 py-2.5 text-[13px]`}
            >
              <div>
                <div className="text-sm font-medium">{name}</div>
                <div className="text-xs text-neutral-600">{s().jobs[job.key]?.what ?? ""}</div>
              </div>
              <div data-testid={`schedule-often-${job.key}`}>
                <Dropdown
                  id={`schedule-often-${job.key}`}
                  size="sm"
                  titleText={s().oftenLabel(name)}
                  hideLabel
                  label={s().oftenLabel(name)}
                  items={items}
                  selectedItem={items.find(i => i.id === job.frequency) ?? items[0]}
                  itemToString={(i: { id: DebriefScheduleFrequency; label: string } | null) =>
                    i?.label ?? ""
                  }
                  onChange={({
                    selectedItem,
                  }: {
                    selectedItem: { id: DebriefScheduleFrequency; label: string } | null;
                  }) =>
                    selectedItem &&
                    selectedItem.id !== job.frequency &&
                    change(job, { frequency: selectedItem.id })
                  }
                />
              </div>
              <span className="text-neutral-700">
                {atLabel(job)}
                {!INTERVALS.has(job.frequency) && (
                  <button
                    type="button"
                    className="ml-2 text-xs text-primary-500 underline"
                    onClick={() => setTimeJob(job)}
                  >
                    {s().changeTime}
                  </button>
                )}
              </span>
              <span>
                {job.locked ? (
                  <ConsoleTag>{s().alwaysOn}</ConsoleTag>
                ) : (
                  <CarbonToggle
                    id={`schedule-on-${job.key}`}
                    size="sm"
                    labelText={s().onLabel(name)}
                    hideLabel
                    labelA={s().off}
                    labelB={s().on}
                    toggled={job.enabled}
                    onToggle={(on: boolean) => change(job, { enabled: on })}
                  />
                )}
              </span>
              <span>
                {job.running ? (
                  <span className="font-semibold text-neutral-700">{s().runningNow}</span>
                ) : last ? (
                  <>
                    <span className={`font-semibold ${RESULT_TONE[last.result]}`}>
                      {s().result[last.result]}
                    </span>
                    <br />
                    <span className="text-xs text-neutral-600">
                      {istWhen(last.startedAt)}
                      {last.error || last.summary ? ` · ${last.error ?? last.summary}` : ""}
                    </span>
                  </>
                ) : (
                  <span className="font-semibold text-neutral-600">{s().notRunYet}</span>
                )}
              </span>
              <span className="text-neutral-700">
                {job.nextRunAt ? istWhen(job.nextRunAt) : s().notScheduled}
              </span>
            </div>
          );
        })}
      </div>
      <RunHistory />
      <ConfirmDialog
        isOpen={pending !== null}
        title={pending ? s().budgetTitle(jobName(pending.job.key)) : ""}
        cancelLabel={s().cancel}
        confirmLabel={s().budgetConfirm}
        isWorking={updating.isLoading}
        onConfirm={() => pending && void save({ ...pending.change, confirmBudget: true })}
        onClose={() => setPending(null)}
      >
        <p className="pb-2">{s().budgetBody}</p>
        <p className="pb-3" data-testid="schedule-budget-estimate">
          {spend ?? s().budgetUnknown}
        </p>
      </ConfirmDialog>
      {timeJob && (
        <TimeDialog
          key={timeJob.key}
          job={timeJob}
          saving={updating.isLoading}
          onSave={c => void save(c)}
          onClose={() => setTimeJob(null)}
        />
      )}
    </div>
  );
};
