import React, { useEffect, useState } from "react";

import { useSelector } from "react-redux";
import { useLocation, useNavigate } from "react-router-dom";
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
import { en, FeatureToggleKey, ROUTES } from "@constants";
import { RootState } from "@store";
import {
  DebriefAutonomyKind,
  DebriefAutonomyStep,
  DebriefAutonomyValue,
  DebriefAutonomyView,
  DebriefOrgOverride,
  DebriefOwnerSettingSpec,
} from "@types";
import { getErrorMessage, hasFeature } from "@utils";

import { inWords, settingName, settingValueLabel } from "../consoleLabels";
import { SettingsSection } from "../consoleRoutes";
import { BackLink, ConsoleTag, Tile } from "../consoleUi";
import { useDebriefAccess } from "../debriefAccess";
import { OrganisationsSection } from "./OrganisationsSection";
import { SchedulesSection } from "./SchedulesSection";
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

type Item = { id: string; label: string; disabled?: boolean };

/**
 * One cell of the autonomy grid: always a dropdown (design `Settings.dc.html`). A cell nobody may
 * change here (Promote, pinned rules, or a reader without the owner's rights) is a disabled
 * dropdown whose reason is in its name and tooltip.
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
 * "Eligible?" for one kind (plan §4): the tests learners never see need only a clean track record;
 * the judge-agreement requirement (κ ≥ 0.6) is shown on the Canary alone.
 */
const EligibleCell: React.FC<{ row: DebriefAutonomyView["kinds"][number]; pinned: boolean }> = ({
  row,
  pinned,
}) => {
  const s = en.debriefs.settingsPage.autonomy;
  if (pinned) return <span className="text-xs text-[#8A3800]">{s.pinnedOnly}</span>;
  const tests = row.eligibility?.quick_test ?? { eligible: true, reason: "" };
  const canary = row.eligibility?.canary ?? { eligible: row.eligible, reason: row.reason };
  const tone = (ok: boolean) => (ok ? "text-success-600" : "text-[#8A3800]");
  return (
    <span className="flex flex-col gap-0.5 text-xs" data-testid="autonomy-eligible">
      {/* Tests learners never see need only a clean record: said only when that broke. */}
      {!tests.eligible && (
        <span className={tone(false)} data-testid="autonomy-eligible-tests">
          {s.testsLabel}: {s.eligibleNo} · {inWords(row.relockReason ?? tests.reason)}
        </span>
      )}
      <span className={tone(canary.eligible)} data-testid="autonomy-eligible-canary">
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
const Autonomy: React.FC<{ canEdit: boolean }> = ({ canEdit }) => {
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
      <p className="m-0 max-w-3xl text-sm text-neutral-600" data-testid="autonomy-intro">
        {s.intro}
      </p>
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
              {view.steps.map((st: DebriefAutonomyStep) => {
                if (kind === "pinned_rules") {
                  return (
                    <CellSelect
                      key={st}
                      id={`autonomy-${kind}-${st}`}
                      label={`${s.kinds[kind]}, ${s.columns[st]}`}
                      value="person"
                      items={[{ id: "person", label: s.aPerson }]}
                      disabled
                      reason={s.pinnedReason}
                      className="bg-neutral-100"
                    />
                  );
                }
                const e = row.eligibility?.[st] ?? { eligible: row.eligible, reason: row.reason };
                // Only the κ gate can be overridden (by the owner, confirmed); never a re-lock,
                // which shows on the steps learners never see too.
                const overridable =
                  st === "canary" && !e.eligible && (row.eligibility?.quick_test?.eligible ?? true);
                const autoLabel = e.eligible
                  ? s.cells.auto
                  : overridable
                    ? s.autoNeedsAgreement
                    : s.autoNotNow;
                return (
                  <CellSelect
                    key={st}
                    id={`autonomy-${kind}-${st}`}
                    label={`${s.kinds[kind]}, ${s.columns[st]}`}
                    value={row.cells[st]}
                    className={CELL_TONE[row.cells[st]]}
                    disabled={!editable || fixed}
                    reason={!editable || fixed ? s.ownerOnlyReason : undefined}
                    items={(["auto", "ask", "off"] as DebriefAutonomyValue[]).map(v => ({
                      id: v,
                      label: v === "auto" ? autoLabel : s.cells[v],
                      // Shown, but not selectable until eligible (an existing "auto" stays as it is).
                      disabled:
                        v === "auto" && !e.eligible && !overridable && row.cells[st] !== "auto",
                    }))}
                    onChange={v =>
                      v === "auto" && overridable && row.cells[st] !== "auto"
                        ? setOverriding(kind)
                        : void run(
                            setMatrix({
                              changes: [{ kind, step: st, value: v as DebriefAutonomyValue }],
                            }).unwrap(),
                          )
                    }
                  />
                );
              })}
              <CellSelect
                id={`autonomy-${kind}-promote`}
                label={`${s.kinds[kind]}, ${s.columns.promote}`}
                value="person"
                items={[{ id: "person", label: s.aPerson }]}
                disabled
                reason={kind === "pinned_rules" ? s.pinnedReason : s.promoteReason}
                className="bg-neutral-100"
              />
              <EligibleCell row={row} pinned={kind === "pinned_rules"} />
              {row.override && row.cells.canary === "auto" && (
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
              {row.relock && (
                <p
                  className="col-span-full m-0 text-xs text-[#8A3800]"
                  data-testid="autonomy-relock"
                >
                  {s.relockedLine(
                    row.relock.steps.map(st => s.columns[st]).join(", "),
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
  // Schedules are for engineering: the per-person `debrief_schedules` toggle (ally-be 403s without it).
  const features = useSelector((state: RootState) => state.user?.features);
  const schedules = hasFeature(features, FeatureToggleKey.DEBRIEF_SCHEDULES);
  const sections = schedules ? [...SECTIONS, "schedules" as const] : SECTIONS;
  // In-page menu: the admin app has a <base href>, so a bare "#budget" resolved to the site root
  // (and from there to a page the viewer may not reach). Stay on this path, scroll to the section,
  // keep the hash for sharing, and mark the section being read.
  const location = useLocation();
  const navigate = useNavigate();
  const [active, setActive] = useState<SettingsSection>(
    () => (location.hash.slice(1) as SettingsSection) || "orgs",
  );
  const goTo = (id: SettingsSection) => {
    setActive(id);
    document.getElementById(id)?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    navigate({ pathname: location.pathname, search: location.search, hash: id }, { replace: true });
  };
  // Opened with a hash (settingsPath("budget")): go there once the sections exist.
  useEffect(() => {
    const id = location.hash.slice(1);
    if (id) document.getElementById(id)?.scrollIntoView?.({ block: "start" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Highlight follows the reader as they scroll.
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return undefined;
    const observer = new IntersectionObserver(
      entries => {
        const top = entries
          .filter(e => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setActive(top.target.id as SettingsSection);
      },
      { rootMargin: "0px 0px -60% 0px" },
    );
    [...sections, "guidance"].forEach(id => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [sections.length]);
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
          {[...sections, "guidance" as const].map(id => (
            <a
              key={id}
              href={`${location.pathname}#${id}`}
              onClick={event => {
                event.preventDefault();
                goTo(id);
              }}
              aria-current={active === id ? "location" : undefined}
              data-testid={`settings-nav-${id}`}
              className={`px-3 py-2 no-underline hover:bg-neutral-50 ${
                active === id
                  ? "border-l-2 border-primary-600 bg-neutral-50 font-semibold text-neutral-900"
                  : "border-l-2 border-transparent text-neutral-700"
              }`}
            >
              {s.nav[id]}
              {id === "guidance" && (
                <>
                  {" "}
                  <span className="text-xs text-neutral-600">{s.contextLibrary}</span>
                </>
              )}
            </a>
          ))}
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
          {schedules && (
            <Section id="schedules" title={s.nav.schedules} help={s.schedulesHelp}>
              <SchedulesSection />
            </Section>
          )}
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
