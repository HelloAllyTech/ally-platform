import React, { useState } from "react";

import { toast } from "sonner";

import { NumberInput } from "@ally-ui-mono/ui-shared";
import {
  useGetDebriefOverviewQuery,
  useGetDebriefSettingsQuery,
  useUpdateDebriefSettingsMutation,
} from "@api";
import { formatUsd } from "@components/ally-guide/allyGuideFormat";
import { ConfirmDialog } from "@components/ally-guide/ConfirmDialog";
import { ContextCollectionLink } from "@components/context-collection-link";
import { en, ROUTES } from "@constants";
import {
  DebriefOrgPolicy,
  DebriefOwnerSettingSpec,
  PmAgentAutonomyCell,
  PmAgentAutonomyStep,
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

/** Budgets: four tiles; a change always asks to confirm, and the PM agent can never make one. */
const Budgets: React.FC<{ canEdit: boolean }> = ({ canEdit }) => {
  const s = en.debriefs.settingsPage.budgets;
  const overview = useGetDebriefOverviewQuery();
  const settings = useGetDebriefSettingsQuery();
  const [update, { isLoading }] = useUpdateDebriefSettingsMutation();
  const [editing, setEditing] = useState<{ key: string; value: number } | null>(null);
  const o = overview.data;
  const v = settings.data;
  const spec = (k: string) => v?.spec[k];
  const tile = (k: string, name: string, value: string, sub: string) => ({ k, name, value, sub });
  const tiles = [
    tile(
      "runCeilingUsd",
      s.ceiling,
      formatUsd((v?.values.runCeilingUsd as number | undefined) ?? o?.budget.runCeilingUsd),
      s.ceilingSub,
    ),
    tile(
      "monthlyCapUsd",
      s.cap,
      formatUsd((v?.values.monthlyCapUsd as number | undefined) ?? o?.budget.monthlyCapUsd),
      o ? s.capSub(formatUsd(o.budget.monthSpentUsd)) : "",
    ),
    tile(
      "learningBudgetUsd",
      s.learning,
      formatUsd((v?.values.learningBudgetUsd as number | undefined) ?? o?.budget.learningBudgetUsd),
      s.learningSub,
    ),
    tile(
      "learningSkimPct",
      s.share,
      v?.values.learningSkimPct != null && spec("learningSkimPct")
        ? settingValueLabel(
            spec("learningSkimPct") as DebriefOwnerSettingSpec,
            v.values.learningSkimPct,
          )
        : "—",
      s.shareSub,
    ),
  ];
  const save = async () => {
    if (!editing) return;
    const sp = spec(editing.key);
    if (!sp) return;
    try {
      await update({ changes: { [editing.key]: fromInput(sp, editing.value) } }).unwrap();
      toast.success(en.debriefs.settings.saved);
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
            <div className="text-[26px] font-semibold">{t.value}</div>
            <div className="text-[13px] text-neutral-600">{t.sub}</div>
            {canEdit && spec(t.k) && (
              <button
                type="button"
                className="self-start text-sm text-primary-500 underline"
                onClick={() => {
                  const sp = spec(t.k) as DebriefOwnerSettingSpec;
                  setEditing({ key: t.k, value: asInput(sp, Number(v?.values[t.k] ?? 0)) });
                }}
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
        isWorking={isLoading}
        onConfirm={() => void save()}
        onClose={() => setEditing(null)}
      >
        <p className="pb-3">{en.debriefs.settings.budgetBody}</p>
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

const CELL_TONE: Record<PmAgentAutonomyCell, string> = {
  alone: "bg-success-50 text-success-600",
  asks_first: "bg-white text-typography-900",
  off: "bg-neutral-100 text-neutral-700",
  never: "bg-neutral-100 text-neutral-700",
};
const STEPS: PmAgentAutonomyStep[] = ["quick", "gate", "trial", "canary"];

/**
 * What the PM agent may do alone: kind of change × test step, and per organisation (which can only
 * tighten). Read here as ally-be sends them; changing a cell waits on ally-be's endpoint.
 */
const Autonomy: React.FC = () => {
  const s = en.debriefs.settingsPage.autonomy;
  const settings = useGetDebriefSettingsQuery();
  const matrix = settings.data?.autonomyMatrix;
  const orgs = settings.data?.orgAutonomy;
  const policy = (p: DebriefOrgPolicy) => s.orgPolicy[p];
  return (
    <div className="flex flex-col gap-4">
      {matrix?.length ? (
        <div className="overflow-x-auto rounded-sm bg-neutral-50" data-testid="autonomy-matrix">
          <div className="grid min-w-[980px] grid-cols-[minmax(150px,1.2fr)_repeat(5,minmax(110px,1fr))_minmax(150px,1.2fr)] gap-2.5 border-b border-neutral-100 px-5 py-2.5 text-xs text-neutral-600">
            <span>{s.columns.kind}</span>
            {STEPS.map(st => (
              <span key={st}>{s.columns[st]}</span>
            ))}
            <span>{s.columns.promote}</span>
            <span>{s.columns.eligible}</span>
          </div>
          {matrix.map(row => (
            <div
              key={row.kind}
              data-testid="autonomy-row"
              className="grid min-w-[980px] grid-cols-[minmax(150px,1.2fr)_repeat(5,minmax(110px,1fr))_minmax(150px,1.2fr)] items-center gap-2.5 border-b border-neutral-100 px-5 py-2.5 text-sm"
            >
              <span className="font-medium">{en.debriefs.pmPage.autonomyKinds[row.kind]}</span>
              {STEPS.map(st => (
                <span key={st}>
                  <span
                    className={`rounded-full px-2 py-[3px] text-xs font-semibold ${CELL_TONE[row.steps[st]]}`}
                  >
                    {s.cells[row.steps[st]]}
                  </span>
                </span>
              ))}
              <span>
                <span className="rounded-full bg-neutral-100 px-2 py-[3px] text-xs font-semibold text-neutral-700">
                  {row.kind === "pinned_rules" ? s.cells.never : s.aPerson}
                </span>
              </span>
              <span className={`text-xs ${row.eligible ? "text-success-600" : "text-[#8A3800]"}`}>
                {row.eligible ? s.eligibleYes : s.eligibleNo}
                {row.eligibleReason ? ` · ${row.eligibleReason}` : ""}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-neutral-600" data-testid="autonomy-missing">
          {s.notYet}
        </p>
      )}
      <SettingsGroups groups={["agent"]} canEdit={false} testId="autonomy-switches" />
      {orgs?.length ? (
        <>
          <div>
            <h3 className="text-base font-semibold">{s.perOrg}</h3>
            <p className="mt-1 max-w-3xl text-sm text-neutral-600">{s.perOrgHelp}</p>
          </div>
          <div className="overflow-x-auto rounded-sm bg-neutral-50" data-testid="org-autonomy">
            <div className="grid min-w-[760px] grid-cols-[minmax(200px,1.4fr)_repeat(3,minmax(170px,1fr))] gap-2.5 border-b border-neutral-100 px-5 py-2.5 text-xs text-neutral-600">
              <span>{s.orgColumns.org}</span>
              <span>{s.orgColumns.trials}</span>
              <span>{s.orgColumns.canaries}</span>
              <span>{s.orgColumns.guidance}</span>
            </div>
            {orgs.map(o => (
              <div
                key={o.tenantId}
                className="grid min-w-[760px] grid-cols-[minmax(200px,1.4fr)_repeat(3,minmax(170px,1fr))] items-center gap-2.5 border-b border-neutral-100 px-5 py-2.5 text-sm"
              >
                <div>
                  <div className="font-medium">{o.tenantName}</div>
                  <div className="text-xs text-neutral-600">
                    {o.live ? s.orgLive : s.orgNotLive}
                  </div>
                </div>
                <span>{policy(o.trials)}</span>
                <span>{policy(o.canaries)}</span>
                <span>{policy(o.guidance)}</span>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
};

const PinnedRules: React.FC = () => {
  const s = en.debriefs.settingsPage.pinned;
  const rules = useGetDebriefSettingsQuery().data?.pinnedRules;
  if (!rules?.length) return <p className="text-sm text-neutral-600">{s.notYet}</p>;
  return (
    <div className="rounded-sm bg-neutral-50" data-testid="pinned-rules">
      {rules.map(r => (
        <div
          key={r.key}
          className="grid grid-cols-[minmax(200px,1.4fr)_90px_minmax(200px,1.6fr)] items-center gap-3 border-b border-neutral-100 px-5 py-3 text-sm"
        >
          <span className="font-medium">{r.name}</span>
          <span>v{r.version}</span>
          <span className="text-[13px] text-neutral-700">
            {r.signedAt
              ? s.signed(
                  r.signedRole ? s.roles[r.signedRole] : (r.signedBy ?? s.someone),
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
  const access = useDebriefAccess();
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
            <Autonomy />
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
