import React, { useState } from "react";

import { ChevronDown } from "lucide-react";
import { useSelector } from "react-redux";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { NumberInput, OverflowMenu, OverflowMenuItem } from "@ally-ui-mono/ui-shared";
import {
  useGetDebriefMeQuery,
  useGetDebriefOverviewQuery,
  useGetDebriefSettingsQuery,
  useSetDebriefBudgetsMutation,
  useUpdateDebriefSettingsMutation,
} from "@api";
import { formatUsd } from "@components/ally-guide/allyGuideFormat";
import { ConfirmDialog } from "@components/ally-guide/ConfirmDialog";
import { ContextCollectionLink } from "@components/context-collection-link";
import { en, FeatureToggleKey, ROUTES } from "@constants";
import { useContextLibraryAccess } from "@pages/ContextLibrary/contextLibraryScope";
import { RootState } from "@store";
import { DebriefOwnerSettingSpec } from "@types";
import { getErrorMessage, hasFeature } from "@utils";

import { settingName, settingValueLabel } from "../consoleLabels";
import { SettingsSection } from "../consoleRoutes";
import { TruncatedTitle } from "../consoleRows";
import { BackLink, ConsoleTag, Tile } from "../consoleUi";
import { useDebriefAccess } from "../debriefAccess";
import { OrganisationsSection } from "./OrganisationsSection";
import { PinnedRulesSection } from "./PinnedRulesSection";
import { SchedulesSection } from "./SchedulesSection";
import { SettingsGroups } from "./SettingsGroups";
import { AutonomyV2, ScoreSettingsV2, TestsV2 } from "./V2Sections";

/** The Debrief Guidance collection, which the Debrief agent reads beside each important moment. */
export const DEBRIEF_GUIDANCE_COLLECTION = "debrief_guidance";

/**
 * The tabs, in the design's order. Schedules (from More, with the toggle) and the guidance card
 * (old `#guidance` links) are views too, but not tabs.
 */
const TABS: SettingsSection[] = [
  "orgs",
  "budget",
  "tests",
  "autonomy",
  "weights",
  "pinned",
  "progress",
];
/** The tabs that move into More below lg (1056px), last first, so the tab row never wraps. */
const NARROW_MORE: SettingsSection[] = ["weights", "pinned", "progress"];

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
/**
 * Debrief settings (redesign 2026-11-12, tabs per design `Settings.dc.html`): organisations,
 * budgets, the tests, autonomy (v2: what always asks a person), the score and the pinned rules;
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
      {/* One row: back, title, the read-only tag, then the owner note, which truncates first. */}
      <div className="flex flex-nowrap items-center gap-3" data-testid="settings-header">
        <div className="shrink-0">
          <BackLink to={ROUTES.DEBRIEFS}>{en.debriefs.title}</BackLink>
        </div>
        <h1 className="shrink-0 whitespace-nowrap font-secondary text-[28px] font-normal">
          {s.title}
        </h1>
        {!access.settings && <ConsoleTag>{s.readOnly}</ConsoleTag>}
        <TruncatedTitle
          text={s.ownerOnly}
          className="text-[13px] text-neutral-600"
          testId="settings-owner-note"
        />
      </div>
      {/* The PM agent page's tabs, kept in view while a long section scrolls. The page scrolls
          inside a padded container (p-4 / lg:p-6): stick at minus that padding and fill it, or the
          section shows through the strip above the tabs. The negative margin keeps the row in place. */}
      <nav
        aria-label={s.tabsLabel}
        className="sticky -top-4 z-10 -mt-4 flex flex-nowrap items-end gap-6 border-b border-neutral-100 bg-white pt-4 text-sm lg:-top-6 lg:-mt-6 lg:pt-6"
        data-testid="settings-tabs"
      >
        {TABS.map(id => (
          <Link
            key={id}
            to={to(id)}
            aria-current={id === current ? "page" : undefined}
            data-testid={`settings-tab-${id}`}
            className={`whitespace-nowrap py-2.5 no-underline ${NARROW_MORE.includes(id) ? "hidden min-[1056px]:inline" : ""} ${id === current ? "border-b-2 border-primary-500 font-semibold text-typography-900" : "text-neutral-600"}`}
          >
            {s.nav[id]}
          </Link>
        ))}
        {/* More holds Schedules and Guidance; below lg also the last tabs, so the row never wraps.
            With nothing else to hold, it shows only below lg. */}
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
          className={`!h-auto !w-auto shrink-0 !bg-transparent !px-0 py-2.5 ${schedules || canOpenGuidance ? "" : "min-[1056px]:!hidden"} ${inMore ? "border-b-2 border-primary-500 font-semibold text-typography-900" : NARROW_MORE.includes(current) ? "text-neutral-600 max-[1055px]:border-b-2 max-[1055px]:border-primary-500 max-[1055px]:font-semibold max-[1055px]:text-typography-900" : "text-neutral-600"}`}
          data-testid="settings-more"
        >
          {NARROW_MORE.map(id => (
            <OverflowMenuItem
              key={id}
              itemText={s.nav[id]}
              wrapperClassName="min-[1056px]:!hidden"
              onClick={() => navigate(to(id))}
            />
          ))}
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
          <Section id="tests" title={s.nav.tests} help={en.debriefs.v2.tests.help}>
            <TestsV2 />
          </Section>
        )}
        {current === "autonomy" && (
          <section id="autonomy" data-testid="settings-section-autonomy">
            <AutonomyV2 canEdit={access.settings} />
          </section>
        )}
        {current === "weights" && (
          <section id="weights" data-testid="settings-section-weights">
            <ScoreSettingsV2 canEdit={access.settings} />
          </section>
        )}
        {current === "pinned" && (
          <Section id="pinned" title={s.nav.pinned} help={s.pinnedHelp}>
            <PinnedRulesSection canAsk={access.approvePinnedRule} />
          </Section>
        )}
        {current === "progress" && (
          <Section id="progress" title={s.nav.progress} help={s.progressHelp}>
            <SettingsGroups
              groups={["progress"]}
              canEdit={access.settings}
              testId="progress-settings"
            />
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
