import React, { useState } from "react";

import { toast } from "sonner";

import { CarbonDropdown as Dropdown, NumberInput } from "@ally-ui-mono/ui-shared";
import {
  useGetDebriefAutonomyQuery,
  useGetDebriefMeQuery,
  useGetDebriefOverviewQuery,
  useGetDebriefPinnedRulesQuery,
  useGetDebriefSettingsQuery,
  useSetDebriefAutonomyMatrixMutation,
  useSetDebriefBudgetsMutation,
  useSetDebriefOrgAutonomyMutation,
  useUpdateDebriefSettingsMutation,
} from "@api";
import { formatUsd } from "@components/ally-guide/allyGuideFormat";
import { ConfirmDialog } from "@components/ally-guide/ConfirmDialog";
import { ContextCollectionLink } from "@components/context-collection-link";
import { en, ROUTES } from "@constants";
import {
  DebriefAutonomyKind,
  DebriefAutonomyStep,
  DebriefAutonomyValue,
  DebriefOrgOverride,
  DebriefOwnerSettingSpec,
} from "@types";
import { getErrorMessage } from "@utils";

import { settingName, settingValueLabel } from "../consoleLabels";
import { SettingsSection } from "../consoleRoutes";
import { BackLink, ConsoleTag, Tile } from "../consoleUi";
import { useDebriefAccess } from "../debriefAccess";
import { OrganisationsSection } from "./OrganisationsSection";
import { SettingsGroups } from "./SettingsGroups";

/** The Debrief Guidance collection, which the Debrief agent reads beside each important moment. */
export const DEBRIEF_GUIDANCE_COLLECTION = "debrief_guidance";

const SECTIONS: SettingsSection[] = ["orgs", "budget", "tests", "autonomy", "weights", "pinned"];

const Section: React.FC<{
  id: SettingsSection;
  title: string;
  help?: string;
  children: React.ReactNode;
}> = ({ id, title, help, children }) => (
  <section
    id={id}
    className="flex scroll-mt-4 flex-col gap-3"
    data-testid={`settings-section-${id}`}
  >
    <div>
      <h2 className="text-xl font-semibold">{title}</h2>
      {help && <p className="mt-1 max-w-3xl text-sm text-neutral-600">{help}</p>}
    </div>
    {children}
  </section>
);

const asInput = (spec: DebriefOwnerSettingSpec, v: number) =>
  spec.kind === "share" ? Math.round(v * 1000) / 10 : v;
const fromInput = (spec: DebriefOwnerSettingSpec, v: number) =>
  spec.kind === "share" ? v / 100 : v;

/** The run ceiling and the monthly cap live in the release (`PUT budgets`); the rest are settings. */
const RELEASE_BUDGETS = new Set(["runCeilingUsd", "monthlyCapUsd"]);

/** Budgets: four tiles; a change always asks to confirm, and the PM agent can never make one. */
const Budgets: React.FC<{ canEdit: boolean }> = ({ canEdit }) => {
  const s = en.debriefs.settingsPage.budgets;
  const overview = useGetDebriefOverviewQuery();
  const settings = useGetDebriefSettingsQuery();
  const [update, updating] = useUpdateDebriefSettingsMutation();
  const [setBudgets, settingBudgets] = useSetDebriefBudgetsMutation();
  const [editing, setEditing] = useState<{ key: string; value: number } | null>(null);
  const o = overview.data;
  const v = settings.data;
  const spec = (k: string): DebriefOwnerSettingSpec | undefined =>
    RELEASE_BUDGETS.has(k) ? { default: 0, kind: "number", min: 0, group: "budget" } : v?.spec[k];
  const tiles = [
    { k: "runCeilingUsd", name: s.ceiling, value: o?.budget.runCeilingUsd, sub: s.ceilingSub },
    {
      k: "monthlyCapUsd",
      name: s.cap,
      value: o?.budget.monthlyCapUsd,
      sub: o ? s.capSub(formatUsd(o.budget.monthSpentUsd)) : "",
    },
    {
      k: "learningBudgetUsd",
      name: s.learning,
      value: (v?.values.learningBudgetUsd as number | undefined) ?? o?.budget.learningBudgetUsd,
      sub: s.learningSub,
    },
    {
      k: "learningSkimPct",
      name: s.share,
      value: v?.values.learningSkimPct as number | undefined,
      sub: s.shareSub,
    },
  ];
  const shown = (k: string, value: number | undefined) =>
    value == null
      ? "—"
      : k === "learningSkimPct" && spec(k)
        ? settingValueLabel(spec(k) as DebriefOwnerSettingSpec, value)
        : formatUsd(value);
  const save = async () => {
    if (!editing) return;
    const sp = spec(editing.key);
    if (!sp) return;
    try {
      if (RELEASE_BUDGETS.has(editing.key)) {
        const r = await setBudgets({ [editing.key]: editing.value }).unwrap();
        toast.success(s.releaseMade(r.version));
      } else {
        await update({ changes: { [editing.key]: fromInput(sp, editing.value) } }).unwrap();
        toast.success(en.debriefs.settings.saved);
      }
      setEditing(null);
    } catch (e) {
      toast.error(getErrorMessage(e, en.debriefs.settings.saveFailed));
    }
  };
  const editingSpec = editing ? spec(editing.key) : undefined;
  return (
    <>
      <div
        className="grid grid-cols-[repeat(auto-fit,minmax(210px,1fr))] gap-3"
        data-testid="budgets"
      >
        {tiles.map(t => (
          <Tile key={t.k} className="flex flex-col gap-1.5 px-5 py-4" testId={`budget-${t.k}`}>
            <div className="text-sm font-semibold">{t.name}</div>
            <div className="text-[26px] font-semibold">{shown(t.k, t.value)}</div>
            <div className="text-[13px] text-neutral-600">{t.sub}</div>
            {canEdit && spec(t.k) && (
              <button
                type="button"
                className="self-start text-sm text-primary-500 underline"
                onClick={() =>
                  setEditing({
                    key: t.k,
                    value: asInput(spec(t.k) as DebriefOwnerSettingSpec, Number(t.value ?? 0)),
                  })
                }
              >
                {s.change}
              </button>
            )}
          </Tile>
        ))}
      </div>
      <ConfirmDialog
        isOpen={editing !== null}
        title={editing ? s.changeTitle(settingName(editing.key)) : ""}
        cancelLabel={en.debriefs.settings.cancel}
        confirmLabel={en.debriefs.settings.budgetConfirm}
        isWorking={updating.isLoading || settingBudgets.isLoading}
        onConfirm={() => void save()}
        onClose={() => setEditing(null)}
      >
        <p className="pb-3">
          {editing && RELEASE_BUDGETS.has(editing.key)
            ? s.releaseBody
            : en.debriefs.settings.budgetBody}
        </p>
        {editing && editingSpec && (
          <NumberInput
            id="budget-input"
            label={settingName(editing.key)}
            min={
              editingSpec.kind === "share" && editingSpec.min != null
                ? editingSpec.min * 100
                : editingSpec.min
            }
            max={
              editingSpec.kind === "share" && editingSpec.max != null
                ? editingSpec.max * 100
                : editingSpec.max
            }
            value={editing.value}
            onChange={(_e: unknown, { value }: { value: number | string }) =>
              setEditing({ ...editing, value: Number(value) })
            }
          />
        )}
      </ConfirmDialog>
    </>
  );
};

/** The rows the grid shows (design 2026-11-12), in this order. */
const MATRIX_KINDS: DebriefAutonomyKind[] = ["settings", "prompts", "pinned_rules"];
const CELL_TONE: Record<DebriefAutonomyValue, string> = {
  auto: "bg-success-50",
  ask: "bg-white",
  off: "bg-neutral-100",
};

type Item = { id: string; label: string };

const CellSelect: React.FC<{
  id: string;
  label: string;
  value: string;
  items: Item[];
  onChange: (v: string) => void;
  className?: string;
}> = ({ id, label, value, items, onChange, className }) => (
  <div className={`w-full ${className ?? ""}`} data-testid={id}>
    <Dropdown
      id={id}
      size="sm"
      titleText={label}
      hideLabel
      label={label}
      items={items}
      selectedItem={items.find(i => i.id === value) ?? items[0]}
      itemToString={(i: Item | null) => i?.label ?? ""}
      onChange={({ selectedItem }: { selectedItem: Item | null }) =>
        selectedItem && onChange(selectedItem.id)
      }
    />
  </div>
);

/**
 * What the PM agent may do alone: kind of change × test step (on its own / asks first / off), and
 * per organisation, which can only tighten. The owner changes them; everyone else reads them.
 */
const Autonomy: React.FC<{ canEdit: boolean }> = ({ canEdit }) => {
  const s = en.debriefs.settingsPage.autonomy;
  const q = useGetDebriefAutonomyQuery();
  const [setMatrix] = useSetDebriefAutonomyMatrixMutation();
  const [setOrg] = useSetDebriefOrgAutonomyMutation();
  const view = q.data;
  const run = async (p: Promise<unknown>) => {
    try {
      await p;
      toast.success(en.debriefs.settings.saved);
    } catch (e) {
      toast.error(getErrorMessage(e, en.debriefs.settings.saveFailed));
    }
  };
  if (!view) {
    return (
      <p className="text-sm text-neutral-600" data-testid="autonomy-missing">
        {q.isError ? s.loadFailed : s.loading}
      </p>
    );
  }
  const editable = canEdit && view.can.change;
  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-x-auto rounded-sm bg-neutral-50" data-testid="autonomy-matrix">
        <div className="grid min-w-[980px] grid-cols-[minmax(170px,1.3fr)_repeat(5,minmax(110px,1fr))_minmax(170px,1.3fr)] gap-2.5 border-b border-neutral-100 px-5 py-2.5 text-xs text-neutral-600">
          <span>{s.columns.kind}</span>
          {view.steps.map(st => (
            <span key={st}>{s.columns[st]}</span>
          ))}
          <span>{s.columns.promote}</span>
          <span>{s.columns.eligible}</span>
        </div>
        {MATRIX_KINDS.map(kind => {
          const row = view.kinds.find(k => k.kind === kind);
          if (!row) return null;
          const fixed = kind === "pinned_rules" || !row.configurable;
          return (
            <div
              key={kind}
              data-testid="autonomy-row"
              className="grid min-w-[980px] grid-cols-[minmax(170px,1.3fr)_repeat(5,minmax(110px,1fr))_minmax(170px,1.3fr)] items-center gap-2.5 border-b border-neutral-100 px-5 py-2.5 text-sm"
            >
              <span className="font-medium">{s.kinds[kind]}</span>
              {view.steps.map((st: DebriefAutonomyStep) =>
                kind === "pinned_rules" ? (
                  <span key={st}>
                    <ConsoleTag>{s.never}</ConsoleTag>
                  </span>
                ) : editable && !fixed ? (
                  <CellSelect
                    key={st}
                    id={`autonomy-${kind}-${st}`}
                    label={`${s.kinds[kind]}, ${s.columns[st]}`}
                    value={row.cells[st]}
                    className={CELL_TONE[row.cells[st]]}
                    items={(["auto", "ask", "off"] as DebriefAutonomyValue[])
                      .filter(v => v !== "auto" || row.eligible || row.cells[st] === "auto")
                      .map(v => ({ id: v, label: s.cells[v] }))}
                    onChange={v =>
                      void run(
                        setMatrix({
                          changes: [{ kind, step: st, value: v as DebriefAutonomyValue }],
                        }).unwrap(),
                      )
                    }
                  />
                ) : (
                  <span key={st}>
                    <span
                      className={`rounded-full px-2 py-[3px] text-xs font-semibold ${CELL_TONE[row.cells[st]]}`}
                    >
                      {s.cells[row.cells[st]]}
                    </span>
                  </span>
                ),
              )}
              <span>
                <ConsoleTag>{kind === "pinned_rules" ? s.never : s.aPerson}</ConsoleTag>
              </span>
              <span className={`text-xs ${row.eligible ? "text-success-600" : "text-[#8A3800]"}`}>
                {kind === "pinned_rules"
                  ? s.pinnedOnly
                  : `${row.eligible ? s.eligibleYes : s.eligibleNo} · ${row.relockReason ?? row.reason}`}
              </span>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-neutral-600" data-testid="autonomy-facts">
        {view.facts.judgeDrift === null ? s.driftFrom : view.facts.judgeDrift ? s.drift : s.noDrift}
        {view.facts.failedBaseline.failed ? ` · ${s.baselineFailed}` : ""}
      </p>
      <SettingsGroups groups={["agent"]} canEdit={canEdit} testId="autonomy-switches" />
      {view.orgs.length > 0 && (
        <>
          <div>
            <h3 className="text-base font-semibold">{s.perOrg}</h3>
            <p className="mt-1 max-w-3xl text-sm text-neutral-600">{s.perOrgHelp}</p>
          </div>
          <div className="overflow-x-auto rounded-sm bg-neutral-50" data-testid="org-autonomy">
            <div className="grid min-w-[620px] grid-cols-[minmax(200px,1.4fr)_repeat(2,minmax(170px,1fr))] gap-2.5 border-b border-neutral-100 px-5 py-2.5 text-xs text-neutral-600">
              <span>{s.orgColumns.org}</span>
              <span>{s.orgColumns.trials}</span>
              <span>{s.orgColumns.canaries}</span>
            </div>
            {view.orgs.map(o => (
              <div
                key={o.tenantId}
                className="grid min-w-[620px] grid-cols-[minmax(200px,1.4fr)_repeat(2,minmax(170px,1fr))] items-center gap-2.5 border-b border-neutral-100 px-5 py-2.5 text-sm"
              >
                <div>
                  <div className="font-medium">{o.tenantName}</div>
                  <div className="text-xs text-neutral-600">
                    {o.live ? s.orgLive : s.orgNotLive}
                  </div>
                </div>
                {(["paired_trial", "canary"] as const).map(k =>
                  editable ? (
                    <CellSelect
                      key={k}
                      id={`org-autonomy-${o.tenantId}-${k}`}
                      label={`${o.tenantName}, ${k === "canary" ? s.orgColumns.canaries : s.orgColumns.trials}`}
                      value={o.overrides[k]}
                      items={(["default", "ask", "never"] as DebriefOrgOverride[]).map(v => ({
                        id: v,
                        label: s.orgPolicy[v],
                      }))}
                      onChange={v =>
                        void run(
                          setOrg({
                            tenantId: o.tenantId,
                            changes: { [k]: v as DebriefOrgOverride },
                          }).unwrap(),
                        )
                      }
                    />
                  ) : (
                    <span key={k}>{s.orgPolicy[o.overrides[k]]}</span>
                  ),
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

const PinnedRules: React.FC = () => {
  const s = en.debriefs.settingsPage.pinned;
  const q = useGetDebriefPinnedRulesQuery();
  const rules = q.data?.rules;
  if (!rules?.length) return <p className="text-sm text-neutral-600">{s.notYet}</p>;
  return (
    <div className="rounded-sm bg-neutral-50" data-testid="pinned-rules">
      {rules.map(r => (
        <div
          key={r.code}
          className="grid grid-cols-[minmax(200px,1.4fr)_90px_minmax(200px,1.6fr)] items-center gap-3 border-b border-neutral-100 px-5 py-3 text-sm"
        >
          <span className="font-medium">{r.label}</span>
          <span>{r.version == null ? "—" : `v${r.version}`}</span>
          <span className="text-[13px] text-neutral-700">
            {r.signedAt
              ? s.signed(
                  r.signedBy?.name ?? s.someone,
                  new Date(r.signedAt).toLocaleDateString(undefined, {
                    day: "numeric",
                    month: "short",
                  }),
                )
              : s.unsigned}
          </span>
        </div>
      ))}
    </div>
  );
};

/**
 * Debrief settings (redesign 2026-11-12): organisations, budgets, the PM agent's tests and
 * freedom, the steering score, the pinned rules, and a link to the guidance. Everyone with the
 * console reads them; only the owner changes them (the Ally team may also stop an organisation).
 */
export const DebriefSettingsPage: React.FC = () => {
  const s = en.debriefs.settingsPage;
  const me = useGetDebriefMeQuery();
  const access = useDebriefAccess(me.data);
  return (
    <div className="flex flex-col gap-6 font-primary" data-testid="debrief-settings-page">
      <div className="flex flex-wrap items-center gap-3">
        <BackLink to={ROUTES.DEBRIEFS}>{en.debriefs.title}</BackLink>
        <h1 className="font-secondary text-[28px] font-normal">{s.title}</h1>
        <span className="text-[13px] text-neutral-600" data-testid="settings-owner-note">
          {s.ownerOnly}
        </span>
        {!access.settings && <ConsoleTag>{s.readOnly}</ConsoleTag>}
      </div>
      <div className="flex flex-wrap items-start gap-8">
        <nav
          aria-label={s.sectionsLabel}
          className="flex max-w-[220px] flex-[1_1_200px] flex-col gap-0.5 text-sm"
        >
          {SECTIONS.map(id => (
            <a
              key={id}
              href={`#${id}`}
              className="px-3 py-2 text-neutral-700 no-underline hover:bg-neutral-50"
            >
              {s.nav[id]}
            </a>
          ))}
          <a
            href="#guidance"
            className="px-3 py-2 text-neutral-700 no-underline hover:bg-neutral-50"
          >
            {s.nav.guidance} <span className="text-xs text-neutral-600">{s.contextLibrary}</span>
          </a>
        </nav>
        <div className="flex min-w-0 max-w-[960px] flex-[999_1_640px] flex-col gap-8">
          <Section id="orgs" title={s.nav.orgs} help={s.orgsHelp}>
            <OrganisationsSection access={access} />
          </Section>
          <Section id="budget" title={s.nav.budget} help={s.budgetHelp}>
            <Budgets canEdit={access.settings} />
          </Section>
          <Section id="tests" title={s.nav.tests} help={s.testsHelp}>
            <SettingsGroups
              groups={["quick", "gate", "trials", "canary", "sealed"]}
              canEdit={access.settings}
              withBaseline
            />
          </Section>
          <Section id="autonomy" title={s.nav.autonomy} help={s.autonomyHelp}>
            <Autonomy canEdit={access.settings} />
          </Section>
          <Section id="weights" title={s.nav.weights} help={s.weightsHelp}>
            <SettingsGroups
              groups={["metrics"]}
              canEdit={access.settings}
              testId="steering-settings"
            />
          </Section>
          <Section id="pinned" title={s.nav.pinned} help={s.pinnedHelp}>
            <PinnedRules />
          </Section>
          <Section id="guidance" title={s.nav.guidance}>
            <div className="max-w-3xl">
              <ContextCollectionLink
                collection={DEBRIEF_GUIDANCE_COLLECTION}
                copy={en.debriefs.guidance}
              />
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
};

export default DebriefSettingsPage;
