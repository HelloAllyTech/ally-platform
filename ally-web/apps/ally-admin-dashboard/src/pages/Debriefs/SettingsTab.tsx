import React, { useMemo, useState } from "react";

import { toast } from "sonner";

import { Button } from "@ally-ui-mono/ui-shared";
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

import { formatWhen } from "./consoleTable";

const GROUPS = ["quick", "gate", "trials", "canary", "sealed", "budget", "metrics"] as const;

type Value = number | boolean;

/** Shares are stored 0–1 and shown as percentages. */
const shown = (spec: DebriefOwnerSettingSpec, v: Value): string =>
  typeof v === "boolean"
    ? v
      ? en.debriefs.settings.yes
      : en.debriefs.settings.no
    : spec.kind === "share"
      ? `${Math.round(v * 1000) / 10}%`
      : String(v);

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
            <table className="w-full text-left text-sm">
              <thead className="text-typography-700">
                <tr>
                  <th className="w-1/4 py-1 font-normal">{s.columns.setting}</th>
                  <th className="w-1/6 py-1 font-normal">{s.columns.value}</th>
                  <th className="w-1/6 py-1 font-normal">{s.columns.proposed}</th>
                  <th className="py-1 font-normal">{s.columns.why}</th>
                </tr>
              </thead>
              <tbody>
                {keys.map(k => {
                  const spec = view.spec[k];
                  const current =
                    draft[k] === undefined ? view.values[k] : (draft[k] ?? view.defaults[k]);
                  const p = proposals[k];
                  return (
                    <tr
                      key={k}
                      className="border-t border-gray-200 align-top"
                      data-testid={`setting-${k}`}
                    >
                      <td className="py-2 pr-2">
                        <div className="flex flex-wrap items-center gap-1">
                          <label htmlFor={`setting-input-${k}`}>{s.names[k] ?? k}</label>
                          {spec.budget && <Pill tone="info">{s.budgetTag}</Pill>}
                        </div>
                        <div className="text-xs text-typography-700">
                          {s.default(shown(spec, view.defaults[k]))}
                        </div>
                      </td>
                      <td className="py-2 pr-2">
                        {spec.kind === "bool" ? (
                          <input
                            id={`setting-input-${k}`}
                            type="checkbox"
                            checked={Boolean(current)}
                            onChange={e => setDraft(d => ({ ...d, [k]: e.target.checked }))}
                          />
                        ) : (
                          <input
                            id={`setting-input-${k}`}
                            type="number"
                            className="w-24 rounded border border-gray-300 px-2 py-1"
                            min={
                              spec.kind === "share" && spec.min != null ? spec.min * 100 : spec.min
                            }
                            max={
                              spec.kind === "share" && spec.max != null ? spec.max * 100 : spec.max
                            }
                            step={spec.kind === "int" ? 1 : "any"}
                            value={toInput(spec, current as Value)}
                            onChange={e => {
                              const v = fromInput(spec, e.target.value);
                              if (v !== null) setDraft(d => ({ ...d, [k]: v }));
                            }}
                          />
                        )}
                        {view.changed.includes(k) && (
                          <button
                            type="button"
                            className="block pt-1 text-xs text-link-primary underline"
                            onClick={() => setDraft(d => ({ ...d, [k]: null }))}
                          >
                            {s.reset}
                          </button>
                        )}
                      </td>
                      <td className="py-2 pr-2">
                        {p ? (
                          <div className="flex flex-col items-start gap-1">
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
                        )}
                      </td>
                      <td className="py-2 text-typography-700">{p?.reason ?? ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
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
