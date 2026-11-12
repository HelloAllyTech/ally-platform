import React, { useState } from "react";

import { toast } from "sonner";

import { Button, Checkbox, TextArea } from "@ally-ui-mono/ui-shared";
import {
  useEmergencyStopDebriefTenantMutation,
  useGetDebriefTenantsQuery,
  useSetDebriefTenantLiveMutation,
  useSetDebriefTenantProvidersMutation,
  useSetDebriefTenantRegionMutation,
} from "@api";
import { formatUsd } from "@components/ally-guide/allyGuideFormat";
import { ConfirmDialog } from "@components/ally-guide/ConfirmDialog";
import { EmptyPanel, ErrorPanel, LoadingBlock } from "@components/ally-guide/ConsoleStates";
import { en } from "@constants";
import { DebriefTenantRow } from "@types";
import { getErrorMessage } from "@utils";

import { ConsoleTag } from "../consoleUi";
import { DebriefAccess } from "../debriefAccess";

/** ally-be `DEBRIEF_APPROVED_PROVIDERS`: adding one is a person's decision, in code review. */
const APPROVED_PROVIDERS = ["gemini", "openai", "anthropic"];

/**
 * Settings › Organisations: which organisations' learners read the new debrief. Switching one on
 * is the owner's; once live, the Ally team may stop it in an emergency (after confirming what
 * learners will see).
 */
export const OrganisationsSection: React.FC<{ access: DebriefAccess }> = ({ access }) => {
  const s = en.debriefs.organisations;
  const t2 = en.debriefs.settingsPage.orgs;
  const tenants = useGetDebriefTenantsQuery();
  const [setLive, { isLoading: switching }] = useSetDebriefTenantLiveMutation();
  const [stop, { isLoading: stopping }] = useEmergencyStopDebriefTenantMutation();
  const [reason, setReason] = useState("");
  const isLoading = switching || stopping;
  const [target, setTarget] = useState<DebriefTenantRow | null>(null);
  const [setRegion, { isLoading: savingRegion }] = useSetDebriefTenantRegionMutation();
  // A region change asks first: it decides whether the organisation may be switched on.
  const [regionTarget, setRegionTarget] = useState<DebriefTenantRow | null>(null);

  // Plan §8.9 (FR-57): which approved providers the organisation's debriefs may use.
  const [setProviders, { isLoading: savingProviders }] = useSetDebriefTenantProvidersMutation();
  const [providersTarget, setProvidersTarget] = useState<DebriefTenantRow | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const providersOf = (t: DebriefTenantRow) => t.providers ?? APPROVED_PROVIDERS;
  const openProviders = (t: DebriefTenantRow) => {
    setPicked(providersOf(t));
    setProvidersTarget(t);
  };
  const saveProviders = async () => {
    const t = providersTarget;
    if (!t || picked.length === 0) return;
    try {
      await setProviders({
        tenantId: t.id,
        providers: APPROVED_PROVIDERS.filter(p => picked.includes(p)),
      }).unwrap();
      toast.success(s.saved);
      setProvidersTarget(null);
    } catch (e) {
      toast.error(getErrorMessage(e, s.failed));
    }
  };
  const providerNames = (list: string[]) => list.map(p => s.providerNames[p] ?? p).join(", ");

  const toggleRegion = async () => {
    const t = regionTarget;
    if (!t) return;
    try {
      await setRegion({
        tenantId: t.id,
        region: t.region === "india" ? "outside_india" : "india",
      }).unwrap();
      toast.success(s.saved);
      setRegionTarget(null);
    } catch (e) {
      toast.error(getErrorMessage(e, s.failed));
    }
  };
  /** What the move does to "Switch on", in words. */
  const regionEffect = (t: DebriefTenantRow) =>
    t.region === "outside_india"
      ? s.regionToIndia
      : t.hasSupportContact
        ? s.regionToOutsideWithLine
        : t.live
          ? s.regionToOutsideLive
          : s.regionToOutside;
  // v9 FR-25: outside India there is no default line to fall back on.
  const blocked = (t: DebriefTenantRow) =>
    !t.live && t.region === "outside_india" && !t.hasSupportContact;

  const confirm = async () => {
    if (!target) return;
    try {
      if (target.live) await stop({ tenantId: target.id, reason: reason.trim() }).unwrap();
      else await setLive({ tenantId: target.id, live: true }).unwrap();
      setReason("");
      toast.success(s.saved);
      setTarget(null);
    } catch (e) {
      toast.error(getErrorMessage(e, s.failed));
    }
  };

  const supportLine = (t: DebriefTenantRow) =>
    t.supportLine ??
    (t.hasSupportContact ? t2.ownLine : t.region === "india" ? t2.indiaDefault : t2.none);
  const note = (t: DebriefTenantRow) =>
    blocked(t)
      ? t2.addLine
      : t.live
        ? `${s.newDebrief}${t.isTest ? ` · ${t2.testOrg}` : ""}`
        : s.todays;

  return (
    <div className="flex flex-col gap-3" data-testid="organisations-tab">
      {tenants.isError ? (
        <ErrorPanel
          forbiddenMessage={en.debriefs.noAccess}
          what={s.loadFailed}
          error={tenants.error}
          onRetry={() => void tenants.refetch()}
        />
      ) : !tenants.data ? (
        <LoadingBlock lines={5} />
      ) : tenants.data.length === 0 ? (
        <EmptyPanel title={s.emptyTitle} message={s.emptyMessage} />
      ) : (
        <div className="overflow-x-auto rounded-sm bg-neutral-50" data-testid="organisations-table">
          {tenants.data.map(t => (
            <div
              key={t.id}
              data-testid="organisation-row"
              className="grid min-w-[860px] grid-cols-[minmax(200px,1.6fr)_minmax(140px,1fr)_minmax(170px,1fr)_minmax(170px,1fr)_150px] items-center gap-3 border-b border-neutral-100 px-5 py-3.5"
            >
              <div>
                <div className="flex items-center gap-2 text-[15px] font-semibold">
                  {t.name}
                  {t.isTest && <ConsoleTag>{s.test}</ConsoleTag>}
                </div>
                <div className={`text-xs ${blocked(t) ? "text-[#8A3800]" : "text-neutral-600"}`}>
                  {note(t)}
                </div>
              </div>
              <div className="text-sm text-neutral-700">
                {t.region === "india" ? s.india : s.outsideIndia}
                {access.switchOn && (
                  <>
                    {" · "}
                    <button
                      type="button"
                      className="text-[13px] text-primary-500 underline"
                      disabled={savingRegion}
                      onClick={() => setRegionTarget(t)}
                    >
                      {t2.change}
                    </button>
                  </>
                )}
              </div>
              <div className="flex flex-col text-sm text-neutral-700">
                <span>{t2.supportLine(supportLine(t))}</span>
                <span className="text-xs text-neutral-600" data-testid="organisation-providers">
                  {s.providersLine(providerNames(providersOf(t)))}
                  {access.switchOn && (
                    <>
                      {" · "}
                      <button
                        type="button"
                        className="text-[13px] text-primary-500 underline"
                        disabled={savingProviders}
                        onClick={() => openProviders(t)}
                      >
                        {t2.change}
                      </button>
                    </>
                  )}
                </span>
              </div>
              <div className="text-sm text-neutral-700" data-testid="organisation-spend">
                {s.spendLine(formatUsd(t.monthSpentUsd ?? 0), t.monthRuns ?? 0)}
              </div>
              <div className="justify-self-end">
                {t.live
                  ? access.emergencyStop && (
                      <Button kind="danger--tertiary" size="sm" onClick={() => setTarget(t)}>
                        {t2.emergencyStop}
                      </Button>
                    )
                  : access.switchOn && (
                      <Button
                        kind="tertiary"
                        size="sm"
                        disabled={blocked(t)}
                        title={blocked(t) ? s.needsSupportLine : undefined}
                        onClick={() => setTarget(t)}
                      >
                        {s.switchOn}
                      </Button>
                    )}
              </div>
            </div>
          ))}
        </div>
      )}
      <ConfirmDialog
        isOpen={target !== null}
        title={target ? (target.live ? t2.stopTitle(target.name) : s.onTitle(target.name)) : ""}
        cancelLabel={s.cancel}
        confirmLabel={target?.live ? t2.emergencyStop : s.switchOn}
        danger={target?.live}
        confirmDisabled={!!target?.live && !reason.trim()}
        isWorking={isLoading}
        onConfirm={() => void confirm()}
        onClose={() => setTarget(null)}
      >
        <p>{target?.live ? t2.stopBody : s.onBody}</p>
        {target?.live && (
          <TextArea
            id="emergency-stop-reason"
            labelText={t2.stopReason}
            rows={2}
            value={reason}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setReason(e.target.value)}
          />
        )}
      </ConfirmDialog>
      <ConfirmDialog
        isOpen={providersTarget !== null}
        title={providersTarget ? s.providersTitle(providersTarget.name) : ""}
        cancelLabel={s.cancel}
        confirmLabel={s.providersConfirm}
        confirmDisabled={picked.length === 0}
        isWorking={savingProviders}
        onConfirm={() => void saveProviders()}
        onClose={() => setProvidersTarget(null)}
      >
        <p>{s.providersBody}</p>
        <fieldset className="mt-3 flex flex-col gap-1" data-testid="organisation-providers-form">
          {APPROVED_PROVIDERS.map(p => (
            <Checkbox
              key={p}
              id={`provider-${p}`}
              labelText={s.providerNames[p] ?? p}
              checked={picked.includes(p)}
              onChange={(_event: unknown, { checked }: { checked: boolean }) =>
                setPicked(previous => (checked ? [...previous, p] : previous.filter(x => x !== p)))
              }
            />
          ))}
        </fieldset>
        {picked.length === 0 && (
          <p className="mt-2 text-xs text-[#8A3800]">{s.providersAtLeastOne}</p>
        )}
      </ConfirmDialog>
      <ConfirmDialog
        isOpen={regionTarget !== null}
        title={
          regionTarget ? s.regionTitle(regionTarget.name, regionTarget.region === "india") : ""
        }
        cancelLabel={s.cancel}
        confirmLabel={s.regionConfirm}
        isWorking={savingRegion}
        onConfirm={() => void toggleRegion()}
        onClose={() => setRegionTarget(null)}
      >
        <p>{regionTarget ? regionEffect(regionTarget) : ""}</p>
      </ConfirmDialog>
    </div>
  );
};
