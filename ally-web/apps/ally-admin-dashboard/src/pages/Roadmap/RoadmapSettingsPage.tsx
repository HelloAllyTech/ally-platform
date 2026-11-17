import React, { useEffect, useMemo, useState } from "react";

import { Navigate } from "react-router-dom";
import { toast } from "sonner";

import {
  Accordion,
  AccordionItem,
  Button,
  CarbonToggle,
  Checkbox,
  InlineNotification,
  Modal,
  Select,
  SelectItem,
  SkeletonText,
  TextArea,
  TextInput,
} from "@ally-ui-mono/ui-shared";
import {
  useGetBuilderSettingsQuery,
  useGetRoadmapProductGoalsQuery,
  useResumeRoadmapAutoReleaseMutation,
  useUpdateBuilderSettingsMutation,
  useUpdateRoadmapV2SettingsMutation,
} from "@api";
import { ROUTES, en } from "@constants";
import type { RoadmapV2SettingsFields } from "@types";

import { AgentEmbedContext } from "../Builder/agentEmbed";
import { BuilderSettings } from "../Builder/BuilderSettings";
import { ProductGoalsManager } from "../ProductRoadmap/ProductGoalsManager";
import { StrategyContextManager } from "../ProductRoadmap/StrategyContextManager";
import { StrategyRankingManager } from "../ProductRoadmap/StrategyRankingManager";
import { RoadmapAreaHeader } from "./components/RoadmapAreaHeader";
import { RoadmapBottomBar } from "./components/RoadmapBottomBar";
import { useRoadmapBreakpoint } from "./hooks/useRoadmapBreakpoint";
import { useRoadmapRole } from "./RoadmapGate";
import { shortDate } from "./utils/copy";
import { canSeeSettings } from "./utils/redirects";
import {
  RoadmapSettingsForm,
  formFromSettings,
  patchFromForm,
  windowIsValid,
} from "./utils/settingsForm";

const t = () => en.roadmapV2Tools.settings;

const Group: React.FC<{
  id: string;
  title: string;
  help: string;
  children: React.ReactNode;
  className?: string;
}> = ({ id, title, help, children, className = "" }) => (
  <section aria-labelledby={id} className={`flex flex-col gap-3 ${className}`}>
    <div>
      <h2 id={id} className="m-0 text-lg font-semibold text-typography-900">
        {title}
      </h2>
      <p className="m-0 text-sm text-typography-600">{help}</p>
    </div>
    {children}
  </section>
);

/**
 * The two switches someone reaches for from a phone (§4.17): the Builder kill switch and Resume
 * auto-release. Turning builds back on asks first; turning them off never waits.
 */
export const EmergencyGroup: React.FC<{
  settings: (RoadmapV2SettingsFields & { enabled?: boolean }) | undefined;
}> = ({ settings }) => {
  const copy = t();
  const [update, { isLoading: saving }] = useUpdateBuilderSettingsMutation();
  const [resume, { isLoading: resuming }] = useResumeRoadmapAutoReleaseMutation();
  const [confirmOn, setConfirmOn] = useState(false);
  const enabled = !!settings?.enabled;
  const pausedAt = settings?.autoReleasePausedAt ?? null;

  const setEnabled = async (on: boolean) => {
    try {
      await update({ enabled: on }).unwrap();
      toast.success(copy.killSwitchSaved(on));
    } catch {
      toast.error(copy.killSwitchFailed);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-md border border-border-light bg-white p-4">
        <CarbonToggle
          id="roadmap-settings-kill-switch"
          size="sm"
          labelText={copy.killSwitch}
          labelA={copy.killSwitchOff}
          labelB={copy.killSwitchOn}
          toggled={enabled}
          disabled={!settings || saving}
          onToggle={(on: boolean) => (on ? setConfirmOn(true) : void setEnabled(false))}
        />
        <p className="m-0 pt-1 text-xs text-typography-600">{copy.killSwitchHelp}</p>
      </div>
      <div className="flex flex-col gap-2 rounded-md border border-border-light bg-white p-4">
        <p className="m-0 text-sm font-medium text-typography-900">{copy.breaker}</p>
        <p className="m-0 text-sm text-typography-600" aria-live="polite">
          {pausedAt
            ? copy.breakerPaused(shortDate(pausedAt), settings?.autoReleasePausedReason ?? "")
            : copy.breakerRunning}
        </p>
        {pausedAt && (
          <Button
            kind="primary"
            size="lg"
            className="w-full max-w-none sm:w-auto"
            disabled={resuming}
            onClick={async () => {
              try {
                const result = await resume().unwrap();
                toast.success(result.wasPausedAt ? copy.resumed : copy.resumeNothing);
              } catch {
                toast.error(copy.resumeFailed);
              }
            }}
          >
            {copy.resume}
          </Button>
        )}
      </div>
      <Modal
        open={confirmOn}
        size="sm"
        modalHeading={copy.killSwitchConfirmTitle}
        primaryButtonText={copy.killSwitchConfirm}
        secondaryButtonText={en.roadmapV2Tools.ship.cancel}
        onRequestClose={() => setConfirmOn(false)}
        onRequestSubmit={() => {
          setConfirmOn(false);
          void setEnabled(true);
        }}
      >
        <p className="text-sm text-typography-900">{copy.killSwitchConfirmBody}</p>
      </Modal>
    </div>
  );
};

/** The `roadmap_v2` switch, behind a confirm both ways: it moves everyone at once (D8). */
export const RoadmapFlagCard: React.FC<{ enabled: boolean }> = ({ enabled }) => {
  const copy = t();
  const [update, { isLoading }] = useUpdateRoadmapV2SettingsMutation();
  const [confirm, setConfirm] = useState<null | boolean>(null);
  return (
    <div className="rounded-md border border-border-light bg-white p-4">
      <CarbonToggle
        id="roadmap-settings-v2-flag"
        size="sm"
        labelText={copy.roadmapFlag}
        labelA=""
        labelB=""
        toggled={enabled}
        disabled={isLoading}
        onToggle={(on: boolean) => setConfirm(on)}
      />
      <p className="m-0 pt-1 text-xs text-typography-600">{copy.roadmapFlagHelp}</p>
      <Modal
        open={confirm !== null}
        size="sm"
        danger={confirm === false}
        modalHeading={confirm ? copy.roadmapFlagOnTitle : copy.roadmapFlagOffTitle}
        primaryButtonText={confirm ? copy.roadmapFlagConfirmOn : copy.roadmapFlagConfirmOff}
        secondaryButtonText={en.roadmapV2Tools.ship.cancel}
        onRequestClose={() => setConfirm(null)}
        onRequestSubmit={async () => {
          const next = confirm;
          setConfirm(null);
          if (next === null) return;
          try {
            await update({ roadmapV2Enabled: next }).unwrap();
          } catch {
            toast.error(copy.roadmapFlagFailed);
          }
        }}
      >
        <p className="text-sm text-typography-900">
          {confirm ? copy.roadmapFlagOnBody : copy.roadmapFlagOffBody}
        </p>
      </Modal>
    </div>
  );
};

/** Release window, held paths and the limits P0 exposed. Saved together. */
export const RoadmapPolicyCard: React.FC<{ settings: RoadmapV2SettingsFields | undefined }> = ({
  settings,
}) => {
  const copy = t();
  const [form, setForm] = useState<RoadmapSettingsForm>(() => formFromSettings(settings));
  useEffect(() => setForm(formFromSettings(settings)), [settings]);
  const [update, { isLoading }] = useUpdateRoadmapV2SettingsMutation();
  const set = <K extends keyof RoadmapSettingsForm>(key: K, value: RoadmapSettingsForm[K]) =>
    setForm(f => ({ ...f, [key]: value }));
  const patch = useMemo(() => patchFromForm(form), [form]);
  const windowBad = form.windowOn && !windowIsValid(form);
  const hours = Array.from({ length: 25 }, (_, h) => h);

  const save = async () => {
    if (!patch) return;
    try {
      await update(patch).unwrap();
      toast.success(copy.saved);
    } catch {
      toast.error(copy.saveFailed);
    }
  };

  return (
    <div className="flex flex-col gap-4 rounded-md border border-border-light bg-white p-4">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium text-typography-900">
          {copy.releaseWindow}
        </legend>
        <p className="m-0 text-xs text-typography-600">{copy.releaseWindowHelp}</p>
        <div role="radiogroup" aria-label={copy.releaseWindow} className="flex flex-wrap gap-2">
          {[false, true].map(on => (
            <button
              key={String(on)}
              type="button"
              role="radio"
              aria-checked={form.windowOn === on}
              onClick={() => set("windowOn", on)}
              className={`min-h-11 rounded-full border px-3 text-sm md:min-h-8 ${
                form.windowOn === on
                  ? "border-primary-600 bg-primary-50 text-primary-700"
                  : "border-border-light text-typography-600"
              }`}
            >
              {on ? copy.releaseWindowSet : copy.releaseWindowAnyTime}
            </button>
          ))}
        </div>
        {form.windowOn && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-x-4" role="group" aria-label={copy.releaseDays}>
              {copy.days.map((label, day) => (
                <Checkbox
                  key={label}
                  id={`roadmap-window-day-${day}`}
                  labelText={label}
                  checked={form.days.includes(day)}
                  onChange={(_e: unknown, { checked }: { checked: boolean }) =>
                    set("days", checked ? [...form.days, day] : form.days.filter(d => d !== day))
                  }
                />
              ))}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Select
                id="roadmap-window-start"
                labelText={copy.releaseStart}
                value={String(form.startHour)}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                  set("startHour", Number(e.target.value))
                }
              >
                {hours.slice(0, 24).map(h => (
                  <SelectItem key={h} value={String(h)} text={copy.hour(h)} />
                ))}
              </Select>
              <Select
                id="roadmap-window-end"
                labelText={copy.releaseEnd}
                value={String(form.endHour)}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                  set("endHour", Number(e.target.value))
                }
              >
                {hours.slice(1).map(h => (
                  <SelectItem key={h} value={String(h)} text={copy.hour(h)} />
                ))}
              </Select>
              <TextInput
                id="roadmap-window-tz"
                labelText={copy.releaseTimeZone}
                value={form.timeZone}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  set("timeZone", e.target.value)
                }
              />
            </div>
            {windowBad && <p className="m-0 text-sm text-red-700">{copy.invalidWindow}</p>}
          </div>
        )}
      </fieldset>

      <TextArea
        id="roadmap-held-paths"
        labelText={copy.heldPaths}
        helperText={
          form.heldPaths.trim()
            ? copy.heldPathsHelp
            : `${copy.heldPathsDefault}. ${copy.heldPathsHelp}`
        }
        rows={5}
        value={form.heldPaths}
        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => set("heldPaths", e.target.value)}
        className="font-mono"
      />

      <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <legend className="mb-2 text-sm font-medium text-typography-900">{copy.limits}</legend>
        <TextInput
          id="roadmap-in-progress-limit"
          type="number"
          inputMode="numeric"
          min={1}
          max={12}
          labelText={copy.inProgressLimit}
          helperText={copy.inProgressLimitHelp}
          value={form.inProgressLimit}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            set("inProgressLimit", e.target.value)
          }
        />
        <TextInput
          id="roadmap-max-lead-ceiling"
          type="number"
          inputMode="decimal"
          min={1}
          labelText={copy.maxLeadCeiling}
          helperText={copy.maxLeadCeilingHelp}
          value={form.maxLeadCeilingUsd}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            set("maxLeadCeilingUsd", e.target.value)
          }
        />
        <TextInput
          id="roadmap-amber-days"
          type="number"
          inputMode="numeric"
          min={1}
          max={60}
          labelText={copy.amberDays}
          helperText={copy.amberDaysHelp}
          value={form.awaitingReviewAmberDays}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            set("awaitingReviewAmberDays", e.target.value)
          }
        />
      </fieldset>
      {!patch && !windowBad && <p className="m-0 text-sm text-red-700">{copy.invalidNumbers}</p>}
      <div>
        <Button kind="primary" size="md" disabled={!patch || isLoading} onClick={() => void save()}>
          {copy.save}
        </Button>
      </div>
    </div>
  );
};

/**
 * Roadmap → Settings (Owner, §4.1): Roadmap (strategy, goals, ranking) and Agent (the roadmap_v2
 * switch, release policy and window, held paths, limits, then Builder's own settings: autonomy,
 * models, budgets, concurrency). The Emergency group — kill switch and Resume — comes first, and on
 * a phone it stays pinned at the top while the rest scrolls (§4.17).
 */
export const RoadmapSettingsPage: React.FC = () => {
  const { role } = useRoadmapRole();
  const breakpoint = useRoadmapBreakpoint();
  const phone = breakpoint === "phone";
  const copy = t();
  const allowed = canSeeSettings(role);
  const { data, isLoading, isError } = useGetBuilderSettingsQuery(undefined, { skip: !allowed });
  const { data: goals, isLoading: goalsLoading } = useGetRoadmapProductGoalsQuery(undefined, {
    skip: !allowed,
  });
  const settings = data as (RoadmapV2SettingsFields & { enabled?: boolean }) | undefined;
  const embed = useMemo(() => ({ embedded: true, readOnly: false }), []);

  if (!allowed) return <Navigate to={ROUTES.ROADMAP} replace />;

  const emergency = (
    <Group id="settings-emergency" title={copy.groups.emergency} help={copy.groupHelp.emergency}>
      <EmergencyGroup settings={settings} />
    </Group>
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <RoadmapAreaHeader phone={phone} current={en.roadmapV2Tools.tabs.settings} />
      {phone && (
        <div
          className="sticky top-0 z-[5] max-h-[45vh] overflow-y-auto border-b border-border-light bg-neutral-50 px-4 py-3"
          data-testid="roadmap-settings-emergency-pinned"
        >
          {emergency}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={`mx-auto flex max-w-4xl flex-col gap-8 px-4 py-6 ${phone ? "pb-24" : ""}`}>
          {!phone && <p className="m-0 text-sm text-typography-600">{copy.intro}</p>}
          {isError && (
            <InlineNotification kind="error" lowContrast hideCloseButton title={copy.loadFailed} />
          )}
          {!phone && emergency}

          <Group id="settings-roadmap" title={copy.groups.roadmap} help={copy.groupHelp.roadmap}>
            <Accordion>
              <AccordionItem title={copy.roadmapSections.strategy}>
                <StrategyContextManager />
              </AccordionItem>
              <AccordionItem title={copy.roadmapSections.goals}>
                <ProductGoalsManager goals={goals ?? []} isLoading={goalsLoading} />
              </AccordionItem>
              <AccordionItem title={copy.roadmapSections.ranking}>
                <StrategyRankingManager />
              </AccordionItem>
            </Accordion>
          </Group>

          <Group id="settings-agent" title={copy.groups.agent} help={copy.groupHelp.agent}>
            {isLoading ? (
              <SkeletonText paragraph lineCount={6} />
            ) : (
              <>
                <RoadmapFlagCard enabled={!!settings?.roadmapV2Enabled} />
                <h3 className="m-0 mt-2 text-base font-semibold text-typography-900">
                  {copy.release}
                </h3>
                <RoadmapPolicyCard settings={settings} />
                <h3 className="m-0 mt-2 text-base font-semibold text-typography-900">
                  {copy.builderAgent}
                </h3>
                <AgentEmbedContext.Provider value={embed}>
                  <BuilderSettings />
                </AgentEmbedContext.Provider>
              </>
            )}
          </Group>
        </div>
      </div>
      {phone && <RoadmapBottomBar hidden={false} />}
    </div>
  );
};
