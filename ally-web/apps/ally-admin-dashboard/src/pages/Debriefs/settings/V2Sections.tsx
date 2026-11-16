import React, { useState } from "react";

import { Link } from "react-router-dom";
import { toast } from "sonner";

import {
  Button,
  Checkbox,
  NumberInput,
  Select,
  SelectItem,
  TextInput,
} from "@ally-ui-mono/ui-shared";
import {
  useGetDebriefAutonomyQuery,
  useGetDebriefSettingsQuery,
  useSetDebriefOrgAutonomyMutation,
  useUpdateDebriefSettingsMutation,
} from "@api";
import { ErrorPanel, LoadingBlock } from "@components/ally-guide/ConsoleStates";
import { en } from "@constants";
import { DebriefOwnerSettingSpec, DebriefSettingsView } from "@types";
import { getErrorMessage } from "@utils";

import { settingName, settingValueLabel } from "../consoleLabels";
import { changesPath } from "../consoleRoutes";
import { ConsoleTable, formatWhen } from "../consoleTable";

type Value = number | boolean | string;

/**
 * The v2 owner settings (V2_AUTONOMY API contract) with their contract defaults and kinds, so the
 * page reads right before ally-be sends their spec. ally-be's spec and values win when present.
 */
export const V2_SETTINGS: Record<
  string,
  { default: Value; kind: DebriefOwnerSettingSpec["kind"] }
> = {
  scoreWeightQuality: { default: 0.4, kind: "share" },
  scoreWeightPass: { default: 0.25, kind: "share" },
  scoreWeightHelpful: { default: 0.2, kind: "share" },
  scoreWeightFlags: { default: 0.15, kind: "share" },
  undoMargin: { default: 0.3, kind: "number" },
  watchDays: { default: 14, kind: "int" },
  canaryShare: { default: 0.1, kind: "share" },
  canaryMinRuns: { default: 40, kind: "int" },
  canaryMinDays: { default: 3, kind: "int" },
  askLowConfidence: { default: true, kind: "bool" },
  askModels: { default: false, kind: "bool" },
  slackChannel: { default: "", kind: "text" },
  safetyContact: { default: "", kind: "text" },
};

const specOf = (view: DebriefSettingsView | undefined, key: string): DebriefOwnerSettingSpec =>
  view?.spec[key] ?? {
    default: (V2_SETTINGS[key]?.default as number | boolean) ?? 0,
    kind: V2_SETTINGS[key]?.kind ?? "number",
    group: "agent",
  };

/** A setting's value in force: ally-be's, else its default, else the contract's. */
export const valueOf = (view: DebriefSettingsView | undefined, key: string): Value =>
  view?.values[key] ?? view?.defaults[key] ?? V2_SETTINGS[key]?.default ?? 0;

const toInput = (spec: DebriefOwnerSettingSpec, v: Value): string =>
  typeof v === "number" && spec.kind === "share" ? String(Math.round(v * 1000) / 10) : String(v);

/**
 * Some owner settings as labelled fields, saved together. Only the owner edits; everyone else
 * reads the values.
 */
const SettingFields: React.FC<{
  keys: string[];
  labels: Record<string, string>;
  canEdit: boolean;
  testId: string;
  /** Under the fields, before Save. */
  note?: (draft: Record<string, Value>) => React.ReactNode;
}> = ({ keys, labels, canEdit, testId, note }) => {
  const s = en.debriefs.settings;
  const q = useGetDebriefSettingsQuery();
  const [update, { isLoading }] = useUpdateDebriefSettingsMutation();
  const [draft, setDraft] = useState<Record<string, Value>>({});
  const view = q.data;
  const current = (k: string) => (k in draft ? draft[k] : valueOf(view, k));
  const changes = Object.fromEntries(
    Object.entries(draft).filter(([k, v]) => v !== valueOf(view, k)),
  );
  const save = async () => {
    try {
      await update({ changes }).unwrap();
      toast.success(s.saved);
      setDraft({});
    } catch (e) {
      toast.error(getErrorMessage(e, s.saveFailed));
    }
  };
  if (q.isError && !view) {
    return (
      <ErrorPanel
        forbiddenMessage={en.debriefs.noAccess}
        what={s.loadFailed}
        error={q.error}
        onRetry={() => void q.refetch()}
      />
    );
  }
  if (!view) return <LoadingBlock lines={4} />;
  return (
    <div className="flex flex-col gap-3" data-testid={testId}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {keys.map(k => {
          const spec = specOf(view, k);
          const v = current(k);
          const id = `v2-setting-${k}`;
          return (
            <div key={k} className="flex flex-col gap-1" data-testid={`v2-setting-${k}`}>
              <label htmlFor={id} className="text-xs text-neutral-700">
                {labels[k] ?? settingName(k)}
              </label>
              {!canEdit ? (
                <span className="text-sm font-semibold" data-testid={`v2-setting-value-${k}`}>
                  {spec.kind === "text"
                    ? String(v) || "—"
                    : settingValueLabel(spec, v as number | boolean)}
                </span>
              ) : spec.kind === "text" ? (
                <TextInput
                  id={id}
                  labelText={labels[k] ?? settingName(k)}
                  hideLabel
                  size="md"
                  value={String(v)}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setDraft(d => ({ ...d, [k]: e.target.value }))
                  }
                />
              ) : (
                <div className="w-40">
                  <NumberInput
                    id={id}
                    size="md"
                    label={labels[k] ?? settingName(k)}
                    hideLabel
                    min={0}
                    step={spec.kind === "number" ? 0.1 : 1}
                    allowEmpty
                    value={toInput(spec, v)}
                    onChange={(_e: unknown, { value }: { value: number | string }) => {
                      const n = Number(value);
                      if (String(value).trim() === "" || !Number.isFinite(n)) return;
                      setDraft(d => ({ ...d, [k]: spec.kind === "share" ? n / 100 : n }));
                    }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
      {note?.(Object.fromEntries(keys.map(k => [k, current(k)])))}
      {canEdit && (
        <div>
          <Button
            kind="primary"
            size="md"
            disabled={isLoading || Object.keys(changes).length === 0}
            onClick={() => void save()}
          >
            {s.save}
          </Button>
        </div>
      )}
    </div>
  );
};

/** One "Always asks a person" row: a checkbox, its name and why. */
const AskRow: React.FC<{
  id: string;
  name: string;
  why: string;
  checked: boolean;
  locked?: boolean;
  disabled?: boolean;
  onChange?: (on: boolean) => void;
}> = ({ id, name, why, checked, locked, disabled, onChange }) => (
  <div
    className="flex flex-nowrap items-start gap-3 border-b border-neutral-100 px-4 py-2.5"
    data-testid="always-asks-row"
    data-locked={locked ? "true" : undefined}
    title={locked ? en.debriefs.v2.autonomy.lockedHelp : undefined}
  >
    <span className="w-8 shrink-0 grow-0">
      <Checkbox
        id={id}
        labelText={name}
        hideLabel
        checked={checked}
        disabled={locked || disabled}
        onChange={(_e: unknown, { checked: on }: { checked: boolean }) => onChange?.(on)}
      />
    </span>
    <span className="flex min-w-0 flex-1 flex-col text-left">
      <span className="text-sm font-medium">{name}</span>
      <span className="text-xs text-neutral-600">{why}</span>
    </span>
  </div>
);

/**
 * Settings › Autonomy (v2, U4): the PM agent ships changes on its own except the kinds that always
 * ask a person; how a change goes live and comes back; and which organisations try changes. The
 * old autonomy matrix and the judge-agreement gate are gone (A6: agreement is information only).
 */
export const AutonomyV2: React.FC<{ canEdit: boolean }> = ({ canEdit }) => {
  const a = en.debriefs.v2.autonomy;
  const q = useGetDebriefSettingsQuery();
  const [update, saving] = useUpdateDebriefSettingsMutation();
  const orgs = useGetDebriefAutonomyQuery();
  const [setOrg] = useSetDebriefOrgAutonomyMutation();
  const watchDays = Number(valueOf(q.data, "watchDays"));
  const flip = async (key: string, on: boolean) => {
    try {
      await update({ changes: { [key]: on } }).unwrap();
      toast.success(en.debriefs.settings.saved);
    } catch (e) {
      toast.error(getErrorMessage(e, en.debriefs.settings.saveFailed));
    }
  };
  const askModels = Boolean(valueOf(q.data, "askModels"));
  return (
    <div className="flex flex-col gap-6" data-testid="autonomy-v2">
      <div>
        <h2 className="text-xl font-semibold">{a.heading}</h2>
        <p className="mt-1 max-w-3xl text-sm text-neutral-600">{a.help(watchDays)}</p>
      </div>
      <section className="flex flex-col gap-2" data-testid="always-asks">
        <h3 className="m-0 text-base font-semibold">{a.alwaysAsks}</h3>
        <div className="rounded-sm bg-neutral-50">
          {a.locked.map((k, i) => (
            <AskRow
              key={k.name}
              id={`always-asks-locked-${i}`}
              name={k.name}
              why={k.why}
              checked
              locked
            />
          ))}
          <AskRow
            id="always-asks-askLowConfidence"
            name={a.askLowConfidence.name}
            why={a.askLowConfidence.why}
            checked={Boolean(valueOf(q.data, "askLowConfidence"))}
            disabled={!canEdit || !q.data || saving.isLoading}
            onChange={on => void flip("askLowConfidence", on)}
          />
          <AskRow
            id="always-asks-askModels"
            name={a.askModels.name}
            why={askModels ? a.askModels.whyOn : a.askModels.whyOff}
            checked={askModels}
            disabled={!canEdit || !q.data || saving.isLoading}
            onChange={on => void flip("askModels", on)}
          />
        </div>
        <p className="m-0 text-xs text-neutral-600">{a.modelsNote}</p>
      </section>
      <section className="flex flex-col gap-2" data-testid="rollout-rules">
        <h3 className="m-0 text-base font-semibold">{a.rollout}</h3>
        <SettingFields
          keys={["canaryShare", "canaryMinRuns", "canaryMinDays", "undoMargin", "watchDays"]}
          labels={a.fields}
          canEdit={canEdit}
          testId="rollout-fields"
          note={() => <p className="m-0 max-w-3xl text-xs text-neutral-600">{a.rolloutNote}</p>}
        />
      </section>
      <section className="flex flex-col gap-2" data-testid="org-tryouts">
        <div>
          <h3 className="m-0 text-base font-semibold">{a.perOrg}</h3>
          <p className="mt-1 max-w-3xl text-sm text-neutral-600">{a.perOrgHelp}</p>
        </div>
        {orgs.isError && !orgs.data ? (
          <p className="text-sm text-neutral-700">{a.loadFailed}</p>
        ) : !orgs.data ? (
          <LoadingBlock lines={3} />
        ) : (
          <div className="overflow-x-auto rounded-sm bg-neutral-50">
            <div className="grid min-w-[560px] grid-cols-[minmax(200px,1.4fr)_minmax(220px,1fr)] gap-2.5 border-b border-neutral-100 px-5 py-2.5 text-xs text-neutral-600">
              <span>{a.orgColumn}</span>
              <span>{a.tryColumn}</span>
            </div>
            {orgs.data.orgs.map(o => {
              const tries = o.overrides.canary !== "never";
              return (
                <div
                  key={o.tenantId}
                  data-testid="org-tryout-row"
                  className="grid min-w-[560px] grid-cols-[minmax(200px,1.4fr)_minmax(220px,1fr)] items-center gap-2.5 border-b border-neutral-100 px-5 py-2.5 text-sm"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium">{o.tenantName}</div>
                    <div className="text-xs text-neutral-600">
                      {o.live ? a.orgLive : o.stopped ? a.orgStopped : a.orgNotLive}
                    </div>
                  </div>
                  {canEdit && orgs.data!.can.change ? (
                    <Select
                      id={`org-tryout-${o.tenantId}`}
                      labelText={`${o.tenantName}, ${a.tryColumn}`}
                      hideLabel
                      size="sm"
                      value={tries ? "default" : "never"}
                      onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                        void setOrg({
                          tenantId: o.tenantId,
                          changes: { canary: e.target.value as "default" | "never" },
                        })
                          .unwrap()
                          .then(() => toast.success(en.debriefs.settings.saved))
                          .catch(err =>
                            toast.error(getErrorMessage(err, en.debriefs.settings.saveFailed)),
                          )
                      }
                    >
                      <SelectItem value="default" text={a.tryYes} />
                      <SelectItem value="never" text={a.tryNo} />
                    </Select>
                  ) : (
                    <span>{tries ? a.tryYes : a.tryNo}</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};

const WEIGHTS = ["scoreWeightQuality", "scoreWeightPass", "scoreWeightHelpful", "scoreWeightFlags"];

/**
 * Settings › Score (v2, U4; was Steering): the four weights of the overall score, the two checks
 * that are never traded off, and where Slack posts.
 */
export const ScoreSettingsV2: React.FC<{ canEdit: boolean }> = ({ canEdit }) => {
  const t = en.debriefs.v2.scoreSettings;
  return (
    <div className="flex flex-col gap-6" data-testid="score-settings">
      <div>
        <h2 className="text-xl font-semibold">{t.heading}</h2>
        <p className="mt-1 max-w-3xl text-sm text-neutral-600">{t.help}</p>
      </div>
      <SettingFields
        keys={WEIGHTS}
        labels={t.fields}
        canEdit={canEdit}
        testId="score-weights"
        note={values => {
          const total = Math.round(
            WEIGHTS.reduce((sum, k) => sum + Number(values[k] ?? 0), 0) * 100,
          );
          return total === 100 ? null : (
            <p className="m-0 text-sm text-[#8A3800]" data-testid="score-weights-off">
              {t.weightsOff(total)}
            </p>
          );
        }}
      />
      <div className="flex flex-col gap-1 rounded-sm bg-neutral-50 px-4 py-3 text-sm">
        <div className="text-xs font-semibold text-neutral-600">{t.neverTraded}</div>
        <div>{t.gateRisk}</div>
        <div>{t.gateCost}</div>
      </div>
      <SettingFields
        keys={["slackChannel", "safetyContact"]}
        labels={t.fields}
        canEdit={canEdit}
        testId="score-slack"
        note={() => (
          <div className="flex flex-col gap-1 text-xs text-neutral-600">
            <p className="m-0">{t.slackHelp}</p>
            <p className="m-0">{t.safetyHelp}</p>
          </div>
        )}
      />
    </div>
  );
};

const TEST_GROUPS = ["quick", "gate", "trials", "canary", "sealed"];

/**
 * Settings › Tests (v2, U4): what each test needs, the value in force and its last change. The PM
 * agent tunes these as ordinary changes (A10); a person no longer accepts proposals here.
 */
export const TestsV2: React.FC = () => {
  const t = en.debriefs.v2.tests;
  const q = useGetDebriefSettingsQuery();
  const view = q.data;
  if (q.isError && !view) {
    return (
      <ErrorPanel
        forbiddenMessage={en.debriefs.noAccess}
        what={en.debriefs.settings.loadFailed}
        error={q.error}
        onRetry={() => void q.refetch()}
      />
    );
  }
  if (!view) return <LoadingBlock lines={6} />;
  const keys = Object.keys(view.spec).filter(k => TEST_GROUPS.includes(view.spec[k].group));
  return (
    <ConsoleTable
      testId="tests-v2"
      headers={[t.columns.setting, t.columns.now, t.columns.last, t.columns.why, ""]}
      rows={keys.map(k => {
        const spec = view.spec[k];
        const last = view.lastChanges?.[k];
        return {
          key: k,
          testId: `test-setting-${k}`,
          cells: [
            <div key="n" className="min-w-[12rem]">
              <div>{settingName(k)}</div>
              <div className="text-xs text-neutral-600">
                {en.debriefs.settings.groups[spec.group] ?? ""}
              </div>
            </div>,
            <span key="v">{settingValueLabel(spec, valueOf(view, k) as number | boolean)}</span>,
            <span key="l">
              {last ? t.lastChange(last.lastChangedBy, formatWhen(last.lastChangedAt)) : "—"}
            </span>,
            <span key="w" className="text-neutral-700">
              {last?.why ?? ""}
            </span>,
            last?.changeId ? (
              <Link key="c" to={changesPath(last.changeId)}>
                {t.seeChange}
              </Link>
            ) : (
              <span key="c" />
            ),
          ],
        };
      })}
    />
  );
};
