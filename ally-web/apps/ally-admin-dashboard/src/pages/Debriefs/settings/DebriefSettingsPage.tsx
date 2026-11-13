import React, { useState } from "react";

import { ChevronDown } from "lucide-react";
import { useSelector } from "react-redux";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";

import {
  CarbonDropdown as Dropdown,
  NumberInput,
  OverflowMenu,
  OverflowMenuItem,
} from "@ally-ui-mono/ui-shared";
import {
  useGetDebriefAutonomyQuery,
  useGetDebriefMeQuery,
  useGetDebriefOverviewQuery,
  useGetDebriefSettingsQuery,
  useSetDebriefAutonomyMatrixMutation,
  useSetDebriefBudgetsMutation,
  useSetDebriefOrgAutonomyMutation,
  useUpdateDebriefSettingsMutation,
} from "@api";
import { formatUsd } from "@components/ally-guide/allyGuideFormat";
import { ConfirmDialog } from "@components/ally-guide/ConfirmDialog";
import { ContextCollectionLink } from "@components/context-collection-link";
import { en, FeatureToggleKey, ROUTES } from "@constants";
import { useContextLibraryAccess } from "@pages/ContextLibrary/contextLibraryScope";
import { RootState } from "@store";
import {
  DebriefAgreementView,
  DebriefAutonomyKind,
  DebriefAutonomyValue,
  DebriefAutonomyView,
  DebriefMeasureAgreement,
  DebriefOrgOverride,
  DebriefOwnerSettingSpec,
} from "@types";
import { getErrorMessage, hasFeature } from "@utils";

import { gateMeasureLabel, inWords, settingName, settingValueLabel } from "../consoleLabels";
import { SettingsSection } from "../consoleRoutes";
import { BackLink, ConsoleTag, Tile } from "../consoleUi";
import { useDebriefAccess } from "../debriefAccess";
import { OrganisationsSection } from "./OrganisationsSection";
import { PinnedRulesSection } from "./PinnedRulesSection";
import { SchedulesSection } from "./SchedulesSection";
import { SettingsGroups } from "./SettingsGroups";

/** The Debrief Guidance collection, which the Debrief agent reads beside each important moment. */
export const DEBRIEF_GUIDANCE_COLLECTION = "debrief_guidance";

/**
 * The tabs, in the design's order. Schedules (from More, with the toggle) and the guidance card
 * (old `#guidance` links) are views too, but not tabs.
 */
const TABS: SettingsSection[] = ["orgs", "budget", "tests", "autonomy", "weights", "pinned"];

const Section: React.FC<{
  id: SettingsSection;
  title: string;
  help?: string;
  children: React.ReactNode;
}> = ({ id, title, help, children }) => (
  <section id={id} className="flex flex-col gap-3" data-testid={`settings-section-${id}`}>
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

/**
 * The rows the grid shows (design `Settings.dc.html` v63), in this order. Pinned rules are not in
 * the grid: the clinical advisor or the owner always approves them (the intro says so).
 */
const MATRIX_KINDS: DebriefAutonomyKind[] = ["settings", "prompts"];
const CELL_TONE: Record<DebriefAutonomyValue, string> = {
  auto: "bg-success-50",
  ask: "bg-white",
  off: "bg-neutral-100",
};

type Item = { id: string; label: string; disabled?: boolean };

/**
 * One cell of the autonomy grid: always a dropdown (design `Settings.dc.html`). A cell nobody may
 * change here (Live for everyone, or a reader without the owner's rights) is a disabled dropdown
 * whose reason is in its name and tooltip.
 */
const CellSelect: React.FC<{
  id: string;
  label: string;
  value: string;
  items: Item[];
  onChange?: (v: string) => void;
  className?: string;
  disabled?: boolean;
  /** Why it can't be changed: tooltip and accessible name. */
  reason?: string;
}> = ({ id, label, value, items, onChange, className, disabled, reason }) => (
  <div
    className={`w-full ${className ?? ""}`}
    data-testid={id}
    title={reason}
    data-disabled={disabled ? "true" : undefined}
  >
    <Dropdown
      id={id}
      size="sm"
      titleText={reason ? `${label}. ${reason}` : label}
      hideLabel
      label={label}
      items={items}
      disabled={disabled}
      selectedItem={items.find(i => i.id === value) ?? items[0]}
      itemToString={(i: Item | null) => i?.label ?? ""}
      onChange={({ selectedItem }: { selectedItem: Item | null }) =>
        selectedItem && !selectedItem.disabled && onChange?.(selectedItem.id)
      }
    />
  </div>
);

/**
 * "Eligible?" for one kind: may "Try on learners" run on its own yet (agreement ≥ 0.6 and a clean
 * track record)? The steps learners never see always run on their own, so they aren't shown.
 */
const EligibleCell: React.FC<{ row: DebriefAutonomyView["kinds"][number] }> = ({ row }) => {
  const s = en.debriefs.settingsPage.autonomy;
  const canary = row.eligibility?.canary ?? { eligible: row.eligible, reason: row.reason };
  const tone = canary.eligible ? "text-success-600" : "text-[#8A3800]";
  return (
    <span className={`text-xs ${tone}`} data-testid="autonomy-eligible">
      <span data-testid="autonomy-eligible-canary">
        {s.columns.canary}: {canary.eligible ? s.eligibleYes : s.eligibleNo.toLowerCase()} ·{" "}
        {inWords(canary.eligible ? canary.reason : (row.relockReason ?? canary.reason))}
      </span>
    </span>
  );
};

/**
 * What the PM agent may do alone: kind of change × test step (on its own / asks first / off), and
 * per organisation, which can only tighten. The owner changes them; everyone else reads them.
 */
const AGREEMENT_FG: Record<DebriefMeasureAgreement["state"], string> = {
  not_enough: "text-neutral-600",
  undefined: "text-neutral-600",
  below: "text-[#8A3800]",
  met: "text-[#0E6027]",
};

/**
 * "Judge agreement with the clinical advisor" (design `Settings.dc.html`): per measure the κ from
 * the advisor's yes/no answers against the judge, the reviews behind it, and how many of the
 * advisor's No the judge also caught. The canary opens only when every measure is met.
 */
export const AgreementPanel: React.FC<{ agreement: DebriefAgreementView }> = ({ agreement }) => {
  const a = en.debriefs.settingsPage.autonomy.agreement;
  return (
    <div className="flex flex-col gap-2.5 bg-neutral-50 px-5 py-4" data-testid="agreement-panel">
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="m-0 text-[15px] font-semibold">{a.heading}</h3>
        <span className="text-xs text-neutral-600">{a.source(agreement.sample.thisWeek)}</span>
      </div>
      <div className="flex flex-col gap-3">
        {agreement.measures.map(m => {
          const k = m.kappa;
          const width = k === null ? 0 : Math.max(0, Math.min(1, k)) * 100;
          return (
            <div
              key={m.measure}
              data-testid={`agreement-row-${m.measure}`}
              className="grid grid-cols-[minmax(96px,150px)_minmax(80px,1fr)_auto] items-center gap-x-3 gap-y-0.5 text-[13px]"
            >
              <span className="font-medium">{gateMeasureLabel(m.measure)}</span>
              <span className="relative h-2.5 bg-neutral-200" aria-hidden="true">
                <span
                  className="absolute inset-y-0 left-0"
                  style={{ width: `${width}%`, background: m.passes ? "#24A148" : "#FF832B" }}
                />
                <span className="absolute -bottom-1 -top-1 left-[60%] w-0.5 bg-[#161616]" />
              </span>
              <span
                className={`text-right font-semibold ${AGREEMENT_FG[m.state]}`}
                title={m.state === "undefined" ? a.undefinedHelp : undefined}
              >
                {a.states[m.state]}
              </span>
              <span className="col-start-2 col-end-4 text-xs text-neutral-600">
                {m.state === "not_enough"
                  ? a.notYet(m.n, m.minReviews)
                  : a.kappa(k === null ? "—" : k.toFixed(2), m.n)}
                {" · "}
                <span title={a.caughtHelp}>{a.caught(m.recallOnNo.caught, m.recallOnNo.of)}</span>
              </span>
            </div>
          );
        })}
      </div>
      <div className="text-xs text-neutral-600">{a.footer(agreement.minReviews)}</div>
    </div>
  );
};

const Autonomy: React.FC<{ canEdit: boolean; onPinned: () => void }> = ({ canEdit, onPinned }) => {
  const s = en.debriefs.settingsPage.autonomy;
  const q = useGetDebriefAutonomyQuery();
  const [setMatrix] = useSetDebriefAutonomyMatrixMutation();
  const [setOrg] = useSetDebriefOrgAutonomyMutation();
  // The kind whose canary the owner is about to let run alone before the κ gate is met.
  const [overriding, setOverriding] = useState<DebriefAutonomyKind | null>(null);
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
      <ConfirmDialog
        isOpen={overriding !== null}
        title={s.overrideTitle}
        cancelLabel={s.overrideCancel}
        confirmLabel={s.overrideConfirm}
        danger
        onClose={() => setOverriding(null)}
        onConfirm={() => {
          const kind = overriding;
          setOverriding(null);
          if (kind) {
            void run(
              setMatrix({
                changes: [{ kind, step: "canary", value: "auto" }],
                override: true,
              }).unwrap(),
            );
          }
        }}
      >
        <p className="m-0" data-testid="autonomy-override-body">
          {overriding ? s.overrideBody(s.kinds[overriding].toLowerCase()) : ""}
        </p>
        <p className="m-0">{s.overrideSafety}</p>
      </ConfirmDialog>
      <ul
        className="m-0 flex max-w-3xl list-disc flex-col gap-1.5 pl-5 text-sm text-neutral-600"
        data-testid="autonomy-intro"
      >
        {s.intro.map(point => (
          <li key={point.lead}>
            <strong className="font-semibold text-neutral-900">{point.lead}</strong> {point.text}
            {point.link && (
              <>
                {" "}
                <a
                  href="#pinned"
                  className="text-primary-600 underline"
                  onClick={event => {
                    event.preventDefault();
                    onPinned();
                  }}
                >
                  {point.link}
                </a>
                .
              </>
            )}
          </li>
        ))}
      </ul>
      {view.agreement && <AgreementPanel agreement={view.agreement} />}
      <div className="overflow-x-auto rounded-sm bg-neutral-50" data-testid="autonomy-matrix">
        <div className="grid min-w-[720px] grid-cols-[minmax(200px,1.4fr)_repeat(2,minmax(170px,1fr))_minmax(200px,1.4fr)] gap-2.5 border-b border-neutral-100 px-5 py-2.5 text-xs text-neutral-600">
          <span>{s.columns.kind}</span>
          <span>{s.columns.canary}</span>
          <span>{s.columns.promote}</span>
          <span>{s.columns.eligible}</span>
        </div>
        {MATRIX_KINDS.map(kind => {
          const row = view.kinds.find(k => k.kind === kind);
          if (!row) return null;
          const fixed = !row.configurable;
          const e = row.eligibility?.canary ?? { eligible: row.eligible, reason: row.reason };
          // Only the agreement requirement can be overridden (by the owner, confirmed); never a
          // re-lock after reverts or a failed baseline.
          const overridable = row.overridable ?? !e.eligible;
          const value = row.cells.canary;
          const autoLabel = e.eligible
            ? s.cells.auto
            : overridable
              ? s.autoNeedsAgreement
              : s.autoNotNow;
          return (
            <div
              key={kind}
              data-testid="autonomy-row"
              className="grid min-w-[720px] grid-cols-[minmax(200px,1.4fr)_repeat(2,minmax(170px,1fr))_minmax(200px,1.4fr)] items-center gap-2.5 border-b border-neutral-100 px-5 py-2.5 text-sm"
            >
              <span className="font-medium">{s.kinds[kind]}</span>
              <CellSelect
                id={`autonomy-${kind}-canary`}
                label={`${s.kinds[kind]}, ${s.columns.canary}`}
                value={value}
                className={CELL_TONE[value]}
                disabled={!editable || fixed}
                reason={!editable || fixed ? s.ownerOnlyReason : undefined}
                items={(["auto", "ask", "off"] as DebriefAutonomyValue[]).map(v => ({
                  id: v,
                  label: v === "auto" ? autoLabel : s.cells[v],
                  // Shown, but not selectable until eligible (an existing "auto" stays as it is).
                  disabled: v === "auto" && !e.eligible && !overridable && value !== "auto",
                }))}
                onChange={v =>
                  v === "auto" && overridable && value !== "auto"
                    ? setOverriding(kind)
                    : void run(
                        setMatrix({
                          changes: [{ kind, step: "canary", value: v as DebriefAutonomyValue }],
                        }).unwrap(),
                      )
                }
              />
              <CellSelect
                id={`autonomy-${kind}-promote`}
                label={`${s.kinds[kind]}, ${s.columns.promote}`}
                value="person"
                items={[{ id: "person", label: s.aPerson }]}
                disabled
                reason={s.promoteReason}
                className="bg-neutral-100"
              />
              <EligibleCell row={row} />
              {row.override && value === "auto" && (
                <p
                  className="col-span-full m-0 text-xs text-[#8A3800]"
                  data-testid="autonomy-override"
                >
                  {s.overrideLine(
                    row.override.name ?? s.someone,
                    new Date(row.override.at).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    }),
                  )}
                </p>
              )}
              {row.relock?.steps.includes("canary") && (
                <p
                  className="col-span-full m-0 text-xs text-[#8A3800]"
                  data-testid="autonomy-relock"
                >
                  {s.relockedLine(
                    s.columns.canary,
                    new Date(row.relock.at).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    }),
                    inWords(row.relock.reason),
                  )}
                </p>
              )}
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
                    {o.live ? s.orgLive : o.stopped ? s.orgStopped : s.orgNotLive}
                  </div>
                </div>
                {(["paired_trial", "canary"] as const).map(k => {
                  // Side-by-side trials: Allowed / Not on its sessions. An older "ask" reads as
                  // allowed (ally-be normalises it); try-outs keep all three.
                  const words = k === "canary" ? s.orgPolicy : s.orgTrialPolicy;
                  const values: DebriefOrgOverride[] =
                    k === "canary" ? ["default", "ask", "never"] : ["default", "never"];
                  const current =
                    k === "paired_trial" && o.overrides[k] === "ask" ? "default" : o.overrides[k];
                  return editable ? (
                    <CellSelect
                      key={k}
                      id={`org-autonomy-${o.tenantId}-${k}`}
                      label={`${o.tenantName}, ${k === "canary" ? s.orgColumns.canaries : s.orgColumns.trials}`}
                      value={current}
                      items={values.map(v => ({ id: v, label: words[v] }))}
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
                    <span key={k}>{words[current]}</span>
                  );
                })}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

/**
 * Debrief settings (redesign 2026-11-12, tabs per design `Settings.dc.html`): organisations,
 * budgets, the PM agent's tests and freedom, the steering score and the pinned rules, one tab each;
 * More holds Schedules (engineering only) and the link to the guidance. The tab is the URL's hash,
 * so `settingsPath("autonomy")` opens that tab. Everyone with the console reads them; only the
 * owner changes them (the Ally team may also stop an organisation).
 */
export const DebriefSettingsPage: React.FC = () => {
  const s = en.debriefs.settingsPage;
  const me = useGetDebriefMeQuery();
  const access = useDebriefAccess(me.data);
  // Schedules are for engineering: the per-person `debrief_schedules` toggle (ally-be 403s without it).
  const features = useSelector((state: RootState) => state.user?.features);
  const schedules = hasFeature(features, FeatureToggleKey.DEBRIEF_SCHEDULES);
  // The guidance link goes where the guidance card goes: only to people the Context Library admits.
  const canOpenGuidance = useContextLibraryAccess().mode === "platform";
  const location = useLocation();
  const navigate = useNavigate();
  // The admin app has a <base href>, so a bare "#budget" resolves to the site root: tabs stay on
  // this path and only change the hash. An unknown (or not permitted) hash opens the first tab.
  const views: SettingsSection[] = [
    ...TABS,
    ...(schedules ? (["schedules"] as const) : []),
    "guidance",
  ];
  const hash = location.hash.slice(1) as SettingsSection;
  const current: SettingsSection = views.includes(hash) ? hash : TABS[0];
  const to = (id: SettingsSection) => ({
    pathname: location.pathname,
    search: location.search,
    hash: id,
  });
  const inMore = !TABS.includes(current);
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
      {/* The PM agent page's tabs, kept in view while a long section scrolls. */}
      <nav
        aria-label={s.tabsLabel}
        className="sticky top-0 z-10 flex flex-wrap items-end gap-6 border-b border-neutral-100 bg-white text-sm"
        data-testid="settings-tabs"
      >
        {TABS.map(id => (
          <Link
            key={id}
            to={to(id)}
            aria-current={id === current ? "page" : undefined}
            data-testid={`settings-tab-${id}`}
            className={`whitespace-nowrap py-2.5 no-underline ${id === current ? "border-b-2 border-primary-500 font-semibold text-typography-900" : "text-neutral-600"}`}
          >
            {s.nav[id]}
          </Link>
        ))}
        {(schedules || canOpenGuidance) && (
          <OverflowMenu
            size="sm"
            align="bottom-start"
            renderIcon={() => (
              <span className="flex items-center gap-1 text-sm">
                {s.more}
                <ChevronDown size={12} aria-hidden="true" />
              </span>
            )}
            iconDescription={s.more}
            className={`!h-auto !w-auto !bg-transparent !px-0 py-2.5 ${inMore ? "border-b-2 border-primary-500 font-semibold text-typography-900" : "text-neutral-600"}`}
            data-testid="settings-more"
          >
            {schedules && (
              <OverflowMenuItem
                itemText={s.nav.schedules}
                onClick={() => navigate(to("schedules"))}
              />
            )}
            {canOpenGuidance && (
              <OverflowMenuItem
                itemText={s.guidanceLink}
                onClick={() =>
                  navigate(`${ROUTES.CONTEXT_LIBRARY}?collection=${DEBRIEF_GUIDANCE_COLLECTION}`)
                }
              />
            )}
          </OverflowMenu>
        )}
      </nav>
      <div className="flex min-w-0 max-w-[960px] flex-col gap-8">
        {current === "orgs" && (
          <Section id="orgs" title={s.nav.orgs} help={s.orgsHelp}>
            <OrganisationsSection access={access} />
          </Section>
        )}
        {current === "budget" && (
          <Section id="budget" title={s.nav.budget} help={s.budgetHelp}>
            <Budgets canEdit={access.settings} />
          </Section>
        )}
        {current === "tests" && (
          <Section id="tests" title={s.nav.tests} help={s.testsHelp}>
            <SettingsGroups
              groups={["quick", "gate", "trials", "canary", "sealed"]}
              canEdit={access.settings}
              withBaseline
            />
          </Section>
        )}
        {current === "autonomy" && (
          <Section id="autonomy" title={s.nav.autonomy}>
            <Autonomy canEdit={access.settings} onPinned={() => navigate(to("pinned"))} />
          </Section>
        )}
        {current === "weights" && (
          <Section id="weights" title={s.nav.weights} help={s.weightsHelp}>
            <SettingsGroups
              groups={["metrics"]}
              canEdit={access.settings}
              testId="steering-settings"
            />
          </Section>
        )}
        {current === "pinned" && (
          <Section id="pinned" title={s.nav.pinned} help={s.pinnedHelp}>
            <PinnedRulesSection canAsk={access.approvePinnedRule} />
          </Section>
        )}
        {current === "schedules" && (
          <Section id="schedules" title={s.nav.schedules} help={s.schedulesHelp}>
            <SchedulesSection />
          </Section>
        )}
        {/* Old links (settingsPath("guidance"), the console's former Knowledge tab) land here. */}
        {current === "guidance" && (
          <Section id="guidance" title={s.nav.guidance}>
            <div className="max-w-3xl">
              <ContextCollectionLink
                collection={DEBRIEF_GUIDANCE_COLLECTION}
                copy={en.debriefs.guidance}
              />
            </div>
          </Section>
        )}
      </div>
    </div>
  );
};

export default DebriefSettingsPage;
