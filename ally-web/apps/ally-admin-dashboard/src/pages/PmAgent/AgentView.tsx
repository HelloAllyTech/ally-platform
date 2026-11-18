import React, { useEffect, useState } from "react";

import { toast } from "sonner";

import {
  Button,
  CarbonToggle,
  ContentSwitcher,
  NumberInput,
  Select,
  SelectItem,
  SkeletonText,
  Switch,
  TextArea,
  TextInput,
} from "@ally-ui-mono/ui-shared";
import {
  useConfirmPmAgentLessonMutation,
  useDeletePmAgentMemoryMutation,
  useGetPmAgentHealthQuery,
  useGetPmAgentHistoryQuery,
  useGetPmAgentMemoryQuery,
  useGetPmAgentFeedStateQuery,
  useRunPmAgentLessonsMutation,
  useUpdatePmAgentMemoryMutation,
} from "@api";
import type { PmAgentStateResponse, PmLesson, PmSettingsPatch } from "@types";

import { copy } from "./copy";
import { absoluteTime, formatPercent, formatUsd, relativeTime } from "./format";
import { usePmAgentControls } from "./usePmAgentControls";
import { InfoTip } from "../../components/ally-guide/InfoTip";

const a = copy.agent;
type Section = "settings" | "memory" | "history" | "health";
const SECTIONS: Section[] = ["settings", "memory", "history", "health"];

const Labelled: React.FC<{ label: string; tip?: string; children: React.ReactNode }> = ({
  label,
  tip,
  children,
}) => (
  <div className="flex items-center gap-2 text-sm text-typography-800">
    <span>{label}</span>
    {tip && <InfoTip label={tip} ariaLabel={`About ${label.toLowerCase()}`} />}
    {children}
  </div>
);

/** Validates a settings form; returns the patch or the per-field errors. Pure. */
export const validateSettings = (input: {
  budget: string;
  cap: string;
  hour: string;
  mandate: string;
  /** Omitted when the backend has no weekly lessons yet. */
  weekday?: string;
}): { patch?: PmSettingsPatch; errors: Record<string, string> } => {
  const errors: Record<string, string> = {};
  const budget = Number(input.budget);
  const cap = Number(input.cap);
  const hour = Number(input.hour);
  if (input.budget.trim() === "" || Number.isNaN(budget) || budget < 0)
    errors.budget = a.invalidBudget;
  if (!Number.isInteger(cap) || cap < 1 || cap > 10) errors.cap = a.invalidCap;
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) errors.hour = a.invalidHour;
  if (!input.mandate.trim()) errors.mandate = a.mandateRequired;
  const weekday = Number(input.weekday);
  if (
    input.weekday !== undefined &&
    (input.weekday.trim() === "" || !Number.isInteger(weekday) || weekday < 0 || weekday > 6)
  )
    errors.weekday = a.invalidWeekday;
  if (Object.keys(errors).length) return { errors };
  return {
    errors,
    patch: {
      monthlyBudgetUsd: budget,
      queueCap: cap,
      runHourIst: hour,
      mandate: input.mandate.trim(),
      ...(input.weekday !== undefined ? { lessonsWeekday: weekday } : {}),
    },
  };
};

const SettingsSection: React.FC<{ state: PmAgentStateResponse }> = ({ state }) => {
  const { settings, budget } = state;
  const controls = usePmAgentControls();
  const [budgetText, setBudgetText] = useState(String(settings.monthlyBudgetUsd));
  const [cap, setCap] = useState(String(settings.queueCap));
  const [hour, setHour] = useState(String(settings.runHourIst));
  const [mandate, setMandate] = useState(settings.mandate);
  const hasLessons = settings.lessonsEnabled !== undefined || settings.lessonsWeekday !== undefined;
  const [weekday, setWeekday] = useState(String(settings.lessonsWeekday ?? 1));
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Pick up server changes (another tab, a socket push) unless the user is mid-edit.
  useEffect(() => {
    setBudgetText(String(settings.monthlyBudgetUsd));
    setCap(String(settings.queueCap));
    setHour(String(settings.runHourIst));
    setMandate(settings.mandate);
    setWeekday(String(settings.lessonsWeekday ?? 1));
  }, [
    settings.monthlyBudgetUsd,
    settings.queueCap,
    settings.runHourIst,
    settings.mandate,
    settings.lessonsWeekday,
  ]);

  const pct =
    budget.monthlyBudgetUsd > 0
      ? Math.min(100, (budget.spentUsd / budget.monthlyBudgetUsd) * 100)
      : 0;

  const submit = async () => {
    const result = validateSettings({
      budget: budgetText,
      cap,
      hour,
      mandate,
      weekday: hasLessons ? weekday : undefined,
    });
    setErrors(result.errors);
    if (!result.patch) return;
    await controls.save(result.patch, a.saved);
  };

  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <div>
        <Labelled label={a.budget} tip={a.budgetTip}>
          {null}
        </Labelled>
        <div
          role="meter"
          aria-label={a.budgetMeter(
            formatUsd(budget.spentUsd, false),
            formatUsd(budget.monthlyBudgetUsd, false),
          )}
          aria-valuemin={0}
          aria-valuemax={budget.monthlyBudgetUsd}
          aria-valuenow={budget.spentUsd}
          className="mt-2 h-3 w-full overflow-hidden rounded bg-neutral-100"
        >
          <div
            className={`h-full ${pct >= 90 ? "bg-red-600" : "bg-primary-600"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="mt-1 text-sm text-typography-700">
          {a.budgetMeter(
            formatUsd(budget.spentUsd, false),
            formatUsd(budget.monthlyBudgetUsd, false),
          )}
          {budget.reservedUsd > 0 && ` · ${a.budgetReserved(formatUsd(budget.reservedUsd, false))}`}
        </p>
      </div>

      <div className="flex flex-wrap gap-4">
        <NumberInput
          id="pm-budget"
          label={a.budget}
          min={0}
          step={10}
          allowEmpty
          value={budgetText}
          onChange={(_e: unknown, { value }: { value: number | string }) =>
            setBudgetText(String(value))
          }
          invalid={Boolean(errors.budget)}
          invalidText={errors.budget ?? ""}
        />
        <div>
          <NumberInput
            id="pm-cap"
            label={a.queueCap}
            min={1}
            max={10}
            allowEmpty
            value={cap}
            onChange={(_e: unknown, { value }: { value: number | string }) => setCap(String(value))}
            invalid={Boolean(errors.cap)}
            invalidText={errors.cap ?? ""}
          />
          <InfoTip label={a.queueCapTip} ariaLabel="About the queue cap" />
        </div>
        <div>
          <NumberInput
            id="pm-hour"
            label={a.runHour}
            min={0}
            max={23}
            allowEmpty
            value={hour}
            onChange={(_e: unknown, { value }: { value: number | string }) =>
              setHour(String(value))
            }
            invalid={Boolean(errors.hour)}
            invalidText={errors.hour ?? ""}
          />
          <InfoTip label={a.runHourTip} ariaLabel="About the run hour" />
        </div>
      </div>

      {hasLessons && (
        <div className="flex flex-col gap-1">
          <div className="flex items-end gap-2">
            <Select
              id="pm-lessons-weekday"
              labelText={a.lessonsWeekday}
              value={weekday}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setWeekday(e.target.value)}
              invalid={Boolean(errors.weekday)}
              invalidText={errors.weekday ?? ""}
            >
              {a.weekdays.map((name, i) => (
                <SelectItem key={name} value={String(i)} text={name} />
              ))}
            </Select>
            <InfoTip label={a.lessonsWeekdayTip} ariaLabel="About the lesson day" />
          </div>
        </div>
      )}

      <div>
        <TextArea
          id="pm-mandate"
          labelText={a.mandate}
          rows={5}
          value={mandate}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setMandate(e.target.value)}
          invalid={Boolean(errors.mandate)}
          invalidText={errors.mandate ?? ""}
        />
        <InfoTip label={a.mandateTip} ariaLabel="About the mandate" />
      </div>

      <div>
        <Button size="md" disabled={controls.saving} onClick={submit}>
          {a.save}
        </Button>
      </div>

      <div className="flex flex-col gap-3 border-t border-neutral-500 pt-4">
        <div className="flex items-center gap-2">
          <CarbonToggle
            id="pm-enabled"
            labelText={a.enabled}
            labelA="Off"
            labelB="On"
            toggled={settings.enabled}
            onToggle={(v: boolean) => controls.save({ enabled: v })}
          />
          <InfoTip label={a.enabledTip} ariaLabel="About the kill switch" />
        </div>
        <div className="flex items-center gap-2">
          <CarbonToggle
            id="pm-slack"
            labelText={a.slackNotify}
            labelA="Off"
            labelB="On"
            toggled={settings.slackNotify}
            onToggle={(v: boolean) => controls.save({ slackNotify: v })}
          />
          <InfoTip label={a.slackNotifyTip} ariaLabel="About Slack notifications" />
        </div>
        {hasLessons && (
          <div className="flex items-center gap-2">
            <CarbonToggle
              id="pm-lessons-enabled"
              labelText={a.lessonsEnabled}
              labelA="Off"
              labelB="On"
              toggled={settings.lessonsEnabled ?? true}
              onToggle={(v: boolean) => controls.save({ lessonsEnabled: v })}
            />
            <InfoTip label={a.lessonsEnabledTip} ariaLabel="About weekly lessons" />
          </div>
        )}
      </div>
    </div>
  );
};

const FactRow: React.FC<{ id: string; value: string; active?: boolean }> = ({
  id,
  value,
  active,
}) => {
  const [update] = useUpdatePmAgentMemoryMutation();
  const [remove] = useDeletePmAgentMemoryMutation();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!text.trim()) {
      setError(a.memoryEmptyValue);
      return;
    }
    try {
      await update({ id, value: text.trim() }).unwrap();
      toast.success(a.memorySaved);
      setEditing(false);
      setError(null);
    } catch {
      toast.error(a.memoryFailed);
    }
  };
  const del = async () => {
    try {
      await remove(id).unwrap();
      toast.success(a.memoryRemoved);
    } catch {
      toast.error(a.memoryFailed);
    }
  };

  return (
    <li className="flex flex-col gap-2 rounded border border-neutral-500 p-3">
      {editing ? (
        <>
          <TextInput
            id={`fact-${id}`}
            labelText="Fact"
            hideLabel
            value={text}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              setText(e.target.value);
              setError(null);
            }}
            invalid={Boolean(error)}
            invalidText={error ?? ""}
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={save}>
              {a.memorySave}
            </Button>
            <Button
              size="sm"
              kind="ghost"
              onClick={() => {
                setEditing(false);
                setText(value);
                setError(null);
              }}
            >
              {a.memoryCancel}
            </Button>
          </div>
        </>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-typography-900">
            {value}
            {active === false && (
              <span className="ml-2 text-xs text-typography-600">({a.memoryInactive})</span>
            )}
          </p>
          <span className="flex gap-1">
            <Button size="sm" kind="tertiary" onClick={() => setEditing(true)}>
              {a.memoryEdit}
            </Button>
            <Button size="sm" kind="ghost" onClick={del}>
              {a.memoryRemove}
            </Button>
          </span>
        </div>
      )}
    </li>
  );
};

const LESSON_GROUPS = ["proposed", "active", "expired"] as const;

const LessonRow: React.FC<{ lesson: PmLesson }> = ({ lesson }) => {
  const [confirm, { isLoading: confirming }] = useConfirmPmAgentLessonMutation();
  const [update] = useUpdatePmAgentMemoryMutation();
  const [remove] = useDeletePmAgentMemoryMutation();
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [text, setText] = useState(lesson.text);
  const [error, setError] = useState<string | null>(null);
  const proposed = lesson.status === "proposed";
  const ev = lesson.evalResult;

  const keep = async () => {
    try {
      await confirm(lesson.id).unwrap();
      toast.success(a.lessonConfirmed);
    } catch {
      toast.error(a.lessonConfirmFailed);
    }
  };
  const save = async () => {
    if (!text.trim()) {
      setError(a.lessonEmptyText);
      return;
    }
    try {
      await update({ id: lesson.id, value: text.trim() }).unwrap();
      toast.success(a.lessonSaved);
      setEditing(false);
      setError(null);
    } catch {
      toast.error(a.lessonFailed);
    }
  };
  const del = async () => {
    try {
      await remove(lesson.id).unwrap();
      toast.success(a.lessonRemoved);
    } catch {
      toast.error(a.lessonFailed);
    }
  };

  return (
    <li className="flex flex-col gap-2 rounded border border-neutral-500 p-3">
      {editing ? (
        <>
          <TextArea
            id={`lesson-${lesson.id}`}
            labelText="Lesson"
            hideLabel
            rows={3}
            value={text}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
              setText(e.target.value);
              setError(null);
            }}
            invalid={Boolean(error)}
            invalidText={error ?? ""}
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={save}>
              {a.lessonSave}
            </Button>
            <Button
              size="sm"
              kind="ghost"
              onClick={() => {
                setEditing(false);
                setText(lesson.text);
                setError(null);
              }}
            >
              {a.lessonCancel}
            </Button>
          </div>
        </>
      ) : (
        <p className="text-sm text-typography-900">{lesson.text}</p>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-typography-700">
        <span className="rounded border border-neutral-500 px-1.5 py-0.5">
          {a.lessonScopeLabel(lesson.scope, lesson.category)}
        </span>
        <span>{a.lessonSupport(lesson.supportCount ?? 0, formatPercent(lesson.supportRatio))}</span>
        {lesson.source === "manual" && <span>{a.lessonManual}</span>}
      </div>
      <p className="text-xs text-typography-700">
        {ev ? (
          <>
            <span aria-hidden="true">{ev.passed ? "✓ " : "⚠ "}</span>
            {(ev.passed ? a.lessonEvalPassed : a.lessonEvalFailed)(
              ev.sampleSize,
              formatPercent(ev.agreementBefore),
              formatPercent(ev.agreementAfter),
            )}
          </>
        ) : (
          a.lessonEvalNone
        )}
      </p>
      {!editing &&
        (removing ? (
          <div
            className="flex flex-wrap items-center gap-2"
            role="group"
            aria-label={a.lessonRemovePrompt}
          >
            <span className="text-sm text-typography-800">{a.lessonRemovePrompt}</span>
            <Button size="sm" kind="danger" onClick={del}>
              {a.lessonRemoveConfirm}
            </Button>
            <Button size="sm" kind="ghost" onClick={() => setRemoving(false)}>
              {a.lessonCancel}
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-1">
            {proposed && (
              <>
                <Button
                  size="sm"
                  kind={lesson.requiresConfirm ? "primary" : "tertiary"}
                  disabled={confirming}
                  onClick={keep}
                >
                  {a.lessonKeep}
                </Button>
                <InfoTip
                  label={lesson.requiresConfirm ? a.lessonKeepTip : a.lessonKeepTipPlain}
                  ariaLabel="About keeping this lesson"
                />
              </>
            )}
            <Button size="sm" kind="tertiary" onClick={() => setEditing(true)}>
              {a.lessonEdit}
            </Button>
            <Button size="sm" kind="ghost" onClick={() => setRemoving(true)}>
              {a.lessonRemove}
            </Button>
          </div>
        ))}
    </li>
  );
};

const LessonsSection: React.FC<{ lessons: PmLesson[] }> = ({ lessons }) => {
  const [runLessons, { isLoading: running }] = useRunPmAgentLessonsMutation();
  const run = async () => {
    try {
      const res = await runLessons().unwrap();
      if (res.started) toast.success(a.lessonsRunStarted);
      else toast.message(a.lessonsRunNotStarted(res.reason));
    } catch {
      toast.error(a.lessonsRunFailed);
    }
  };
  const visible = lessons.filter(l => l && l.text && l.status !== "removed");
  return (
    <section aria-label={a.lessonsTitle} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-typography-900">{a.lessonsTitle}</h3>
        <span className="flex items-center gap-1">
          <Button kind="tertiary" size="sm" disabled={running} onClick={run}>
            {running ? a.lessonsRunning : a.lessonsRun}
          </Button>
          <InfoTip label={a.lessonsRunTip} ariaLabel="About running the lesson review" />
        </span>
      </div>
      {visible.length === 0 ? (
        <p className="text-sm text-typography-600">{a.lessonsEmpty}</p>
      ) : (
        <>
          <p className="text-sm text-typography-700">{a.lessonsIntro}</p>
          {LESSON_GROUPS.map(g => {
            const items = visible.filter(l => l.status === g);
            if (items.length === 0) return null;
            return (
              <section key={g} aria-label={a.lessonGroups[g]} className="flex flex-col gap-2">
                <h4 className="text-sm font-semibold text-typography-800">
                  {a.lessonGroups[g]} <span className="font-normal">({items.length})</span>
                </h4>
                <ul className="flex flex-col gap-2">
                  {items.map(l => (
                    <LessonRow key={l.id} lesson={l} />
                  ))}
                </ul>
              </section>
            );
          })}
        </>
      )}
    </section>
  );
};

const MemorySection: React.FC = () => {
  const { data, isLoading } = useGetPmAgentMemoryQuery();
  if (isLoading) return <SkeletonText paragraph lineCount={3} />;
  const facts = data?.facts ?? [];
  const lessons = data?.lessons ?? [];
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <section aria-label={a.sections.memory} className="flex flex-col gap-2">
        <p className="text-sm text-typography-700">{a.memoryIntro}</p>
        {facts.length === 0 ? (
          <p className="text-sm text-typography-600">{a.memoryEmpty}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {facts.map(f => (
              <FactRow key={f.id} id={f.id} value={f.value} active={f.active} />
            ))}
          </ul>
        )}
      </section>
      <LessonsSection lessons={lessons} />
    </div>
  );
};

const HistorySection: React.FC = () => {
  const { data, isLoading } = useGetPmAgentHistoryQuery();
  if (isLoading) return <SkeletonText paragraph lineCount={3} />;
  const cards = data?.cards ?? [];
  return (
    <section aria-label={a.sections.history} className="flex max-w-2xl flex-col gap-2">
      <p className="text-sm text-typography-700">{a.historyIntro}</p>
      {cards.length === 0 ? (
        <p className="text-sm text-typography-600">{a.historyEmpty}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {cards.map(c => (
            <li
              key={c.id}
              className="flex flex-wrap items-baseline justify-between gap-2 rounded border border-neutral-500 p-3"
            >
              <span className="text-sm text-typography-900">{c.title}</span>
              <span
                className="text-xs text-typography-600"
                title={absoluteTime(c.decidedAt ?? c.createdAt)}
              >
                {a.historyOutcome[c.status] ?? c.status} ·{" "}
                {relativeTime(c.decidedAt ?? c.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

const countOrDash = (n: number | null | undefined): string =>
  n === null || n === undefined || Number.isNaN(n) ? "-" : String(n);

const HealthSection: React.FC = () => {
  const { data, isLoading, isError } = useGetPmAgentHealthQuery();
  if (isLoading) return <SkeletonText paragraph lineCount={3} />;
  if (isError || !data) return <p className="text-sm text-red-700">{a.healthLoadError}</p>;
  const rows: { key: keyof typeof a.metrics; value: string }[] = [
    { key: "acceptRate7d", value: formatPercent(data.acceptRate7d) },
    { key: "acceptRate30d", value: formatPercent(data.acceptRate30d) },
    { key: "shippedRate", value: formatPercent(data.shippedRate) },
    { key: "costPerAcceptedCardUsd", value: formatUsd(data.costPerAcceptedCardUsd) },
    { key: "repeatedRejectionRate", value: formatPercent(data.repeatedRejectionRate) },
    { key: "impactMeasuredCount", value: countOrDash(data.impactMeasuredCount) },
    { key: "impactImprovedRate", value: formatPercent(data.impactImprovedRate) },
    { key: "activeLessons", value: countOrDash(data.activeLessons) },
    { key: "proposedLessons", value: countOrDash(data.proposedLessons) },
    {
      key: "lessonAgreementDelta",
      value:
        data.lessonAgreementDelta == null || Number.isNaN(data.lessonAgreementDelta)
          ? "-"
          : `${data.lessonAgreementDelta > 0 ? "+" : ""}${
              Math.round(
                (Math.abs(data.lessonAgreementDelta) <= 1
                  ? data.lessonAgreementDelta * 100
                  : data.lessonAgreementDelta) * 10,
              ) / 10
            } pts`,
    },
  ];
  const lanes = Object.entries(data.spendByLane ?? {});
  return (
    <section aria-label={a.healthTitle} className="flex max-w-2xl flex-col gap-4">
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {rows.map(r => (
          <div key={r.key} className="rounded border border-neutral-500 p-3">
            <dt className="flex items-center gap-1 text-sm text-typography-700">
              {a.metrics[r.key]}
              <InfoTip
                label={a.metricTips[r.key]}
                ariaLabel={`About ${a.metrics[r.key].toLowerCase()}`}
              />
            </dt>
            <dd className="text-xl font-semibold text-typography-900">{r.value}</dd>
          </div>
        ))}
      </dl>
      {lanes.length > 0 && (
        <div>
          <h3 className="mb-1 text-sm font-semibold text-typography-800">{a.spendByLane}</h3>
          <ul className="text-sm text-typography-800">
            {lanes.map(([lane, usd]) => (
              <li key={lane} className="flex justify-between border-b border-neutral-100 py-1">
                <span>{lane.replace(/_/g, " ")}</span>
                <span>{formatUsd(usd)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
};

export const AgentView: React.FC<{ initialSection?: Section }> = ({
  initialSection = "settings",
}) => {
  const [section, setSection] = useState<Section>(initialSection);
  const { data: state, isLoading, isError } = useGetPmAgentFeedStateQuery();

  return (
    <div className="flex flex-col gap-4">
      <div className="max-w-xl">
        <ContentSwitcher
          size="md"
          selectedIndex={SECTIONS.indexOf(section)}
          onChange={(e: { name?: string | number }) => setSection(String(e.name) as Section)}
        >
          {SECTIONS.map(s => (
            <Switch key={s} name={s} text={a.sections[s]} />
          ))}
        </ContentSwitcher>
      </div>
      {section === "settings" &&
        (isLoading ? (
          <SkeletonText paragraph lineCount={4} />
        ) : isError || !state ? (
          <p className="text-sm text-red-700">{a.loadError}</p>
        ) : (
          <SettingsSection state={state} />
        ))}
      {section === "memory" && <MemorySection />}
      {section === "history" && <HistorySection />}
      {section === "health" && <HealthSection />}
    </div>
  );
};
