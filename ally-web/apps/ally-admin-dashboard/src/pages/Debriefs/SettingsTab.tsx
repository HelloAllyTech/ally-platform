import React, { useMemo, useState } from "react";

import { toast } from "sonner";

import { Button, CarbonToggle, NumberInput } from "@ally-ui-mono/ui-shared";
import {
  useAcceptDebriefBaselineMutation,
  useGetDebriefSettingsQuery,
  useRunDebriefBaselineMutation,
  useUpdateDebriefSettingsMutation,
} from "@api";
import { formatUsd } from "@components/ally-guide/allyGuideFormat";
import { ConfirmDialog } from "@components/ally-guide/ConfirmDialog";
import { ErrorPanel, LoadingBlock } from "@components/ally-guide/ConsoleStates";
import { Pill } from "@components/ally-guide/Pill";
import { en } from "@constants";
import { DebriefOwnerSettingSpec, DebriefSettingsView } from "@types";
import { getErrorMessage } from "@utils";

import { settingName, settingValueLabel as shown } from "./consoleLabels";
import { ConsoleTable, formatWhen } from "./consoleTable";

const GROUPS = [
  "quick",
  "gate",
  "trials",
  "canary",
  "sealed",
  "budget",
  "metrics",
  "agent",
] as const;

type Value = number | boolean;

const toInput = (spec: DebriefOwnerSettingSpec, v: Value): string =>
  typeof v === "boolean"
    ? ""
    : spec.kind === "share"
      ? String(Math.round(v * 1000) / 10)
      : String(v);

const fromInput = (spec: DebriefOwnerSettingSpec, raw: string): number | null => {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return spec.kind === "share" ? n / 100 : n;
};

/** The owner settings page (v9 FR-60): every threshold of the PM agent's test ladder, and its budgets. */
export const SettingsTab: React.FC = () => {
  const s = en.debriefs.settings;
  const settings = useGetDebriefSettingsQuery();
  const [update, { isLoading: saving }] = useUpdateDebriefSettingsMutation();
  const [accept, { isLoading: accepting }] = useAcceptDebriefBaselineMutation();
  const [runBaseline, { isLoading: proposing }] = useRunDebriefBaselineMutation();
  const [draft, setDraft] = useState<Record<string, Value | null>>({});
  const [budgetAsk, setBudgetAsk] = useState<null | (() => Promise<void>)>(null);

  const view = settings.data;
  const changes = useMemo(() => {
    if (!view) return {};
    const out: Record<string, Value | null> = {};
    for (const [k, v] of Object.entries(draft)) {
      if (v === null ? view.changed.includes(k) : v !== view.values[k]) out[k] = v;
    }
    return out;
  }, [draft, view]);
  const touchesBudget = (keys: string[]) => keys.some(k => view?.spec[k]?.budget);

  const guarded = (keys: string[], act: () => Promise<void>) =>
    touchesBudget(keys) ? setBudgetAsk(() => act) : void act();

  const save = async () => {
    try {
      await update({ changes }).unwrap();
      toast.success(s.saved);
      setDraft({});
    } catch (e) {
      toast.error(getErrorMessage(e, s.saveFailed));
    }
  };
  const acceptKeys = async (keys: string[]) => {
    try {
      await accept({ keys }).unwrap();
      toast.success(s.saved);
      setDraft(d => Object.fromEntries(Object.entries(d).filter(([k]) => !keys.includes(k))));
    } catch (e) {
      toast.error(getErrorMessage(e, s.saveFailed));
    }
  };
  const propose = async () => {
    try {
      await runBaseline().unwrap();
      toast.success(s.baselineDone);
    } catch (e) {
      toast.error(getErrorMessage(e, s.baselineFailed));
    }
  };

  if (settings.isError) {
    return (
      <ErrorPanel
        what={s.loadFailed}
        error={settings.error}
        onRetry={() => void settings.refetch()}
      />
    );
  }
  if (!view) return <LoadingBlock lines={8} />;

  const proposals = view.baseline?.proposals ?? {};
  const acceptable = Object.keys(proposals).filter(
    k => !view.spec[k]?.budget && proposals[k].value !== view.values[k],
  );

  return (
    <div className="flex flex-col gap-6" data-testid="debrief-settings-tab">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-normal text-typography-900">{s.heading}</h2>
          <p className="max-w-3xl pt-1 text-sm text-typography-700">{s.help}</p>
          <p className="max-w-3xl pt-1 text-sm text-typography-700" data-testid="baseline-facts">
            {view.baseline ? <BaselineFacts view={view} /> : s.baselineNever}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button kind="tertiary" size="md" disabled={proposing} onClick={() => void propose()}>
            {proposing ? s.baselineRunning : s.runBaseline}
          </Button>
          {acceptable.length > 0 && (
            <Button
              kind="secondary"
              size="md"
              disabled={accepting}
              onClick={() => void acceptKeys(acceptable)}
            >
              {s.acceptAll}
            </Button>
          )}
        </div>
      </div>

      {GROUPS.map(group => {
        const keys = Object.keys(view.spec).filter(k => view.spec[k].group === group);
        if (!keys.length) return null;
        return (
          <section key={group} className="flex flex-col gap-2" data-testid={`settings-${group}`}>
            <h3 className="text-base font-semibold text-typography-900">{s.groups[group]}</h3>
            <ConsoleTable
              testId={`settings-table-${group}`}
              headers={[s.columns.setting, s.columns.value, s.columns.proposed, s.columns.why]}
              rows={keys.map(k => {
                const spec = view.spec[k];
                const current =
                  draft[k] === undefined ? view.values[k] : (draft[k] ?? view.defaults[k]);
                const p = proposals[k];
                const id = `setting-input-${k}`;
                return {
                  key: k,
                  testId: `setting-${k}`,
                  cells: [
                    <div key="n" className="min-w-[12rem]">
                      <div className="flex flex-wrap items-center gap-1">
                        <label htmlFor={id}>{settingName(k)}</label>
                        {spec.budget && <Pill tone="info">{s.budgetTag}</Pill>}
                      </div>
                      <div className="text-xs text-typography-700">
                        {s.default(shown(spec, view.defaults[k]))}
                      </div>
                    </div>,
                    <div key="v" className="flex flex-col items-start gap-1">
                      {spec.kind === "bool" ? (
                        <CarbonToggle
                          id={id}
                          size="sm"
                          // The setting's name in the first column labels it (htmlFor); the
                          // side label says the state.
                          labelText=""
                          labelA={s.no}
                          labelB={s.yes}
                          toggled={Boolean(current)}
                          onToggle={(on: boolean) => setDraft(d => ({ ...d, [k]: on }))}
                        />
                      ) : (
                        <div className="w-36">
                          <NumberInput
                            id={id}
                            size="sm"
                            label={settingName(k)}
                            hideLabel
                            min={
                              spec.kind === "share" && spec.min != null ? spec.min * 100 : spec.min
                            }
                            max={
                              spec.kind === "share" && spec.max != null ? spec.max * 100 : spec.max
                            }
                            step={1}
                            allowEmpty
                            value={toInput(spec, current as Value)}
                            onChange={(_e: unknown, { value }: { value: number | string }) => {
                              const v = fromInput(spec, String(value));
                              if (v !== null) setDraft(d => ({ ...d, [k]: v }));
                            }}
                          />
                        </div>
                      )}
                      {view.changed.includes(k) && (
                        <Button
                          kind="ghost"
                          size="sm"
                          onClick={() => setDraft(d => ({ ...d, [k]: null }))}
                        >
                          {s.reset}
                        </Button>
                      )}
                    </div>,
                    p ? (
                      <div key="p" className="flex flex-col items-start gap-1">
                        <span>{shown(spec, p.value)}</span>
                        {p.misfit && <Pill tone="warning">{s.misfit}</Pill>}
                        {p.value !== view.values[k] && (
                          <Button
                            kind="ghost"
                            size="sm"
                            disabled={accepting}
                            onClick={() => guarded([k], () => acceptKeys([k]))}
                          >
                            {s.accept}
                          </Button>
                        )}
                      </div>
                    ) : (
                      s.noProposal
                    ),
                    <span key="w" className="text-typography-700">
                      {p?.reason ?? ""}
                    </span>,
                  ],
                };
              })}
            />
          </section>
        );
      })}

      <div>
        <Button
          kind="primary"
          size="md"
          disabled={saving || Object.keys(changes).length === 0}
          onClick={() => guarded(Object.keys(changes), save)}
        >
          {s.save}
        </Button>
      </div>

      <ConfirmDialog
        isOpen={budgetAsk !== null}
        title={s.budgetTitle}
        cancelLabel={s.cancel}
        confirmLabel={s.budgetConfirm}
        isWorking={saving || accepting}
        onClose={() => setBudgetAsk(null)}
        onConfirm={() => {
          const act = budgetAsk;
          setBudgetAsk(null);
          void act?.();
        }}
      >
        <p>{s.budgetBody}</p>
      </ConfirmDialog>
    </div>
  );
};

const BaselineFacts: React.FC<{ view: DebriefSettingsView }> = ({ view }) => {
  const b = view.baseline!;
  const f = b.facts;
  const num = (x: number | null | undefined, d = 1) => (x == null ? "—" : x.toFixed(d));
  return (
    <>
      {en.debriefs.settings.baselineFacts(
        formatWhen(b.ranAt),
        num(f.runsPerDay),
        num(f.judge?.median),
        num(f.rejudge?.sdOfDifference, 2),
        f.costPerRunUsd?.p50 == null ? "—" : formatUsd(f.costPerRunUsd.p50),
      )}
    </>
  );
};
