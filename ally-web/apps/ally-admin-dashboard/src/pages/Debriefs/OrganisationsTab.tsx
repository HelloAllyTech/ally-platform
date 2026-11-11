import React, { useState } from "react";

import { toast } from "sonner";

import { Button } from "@ally-ui-mono/ui-shared";
import {
  useGetDebriefTenantsQuery,
  useSetDebriefTenantLiveMutation,
  useSetDebriefTenantRegionMutation,
} from "@api";
import { formatUsd } from "@components/ally-guide/allyGuideFormat";
import { ConfirmDialog } from "@components/ally-guide/ConfirmDialog";
import { ErrorPanel, LoadingBlock } from "@components/ally-guide/ConsoleStates";
import { Pill } from "@components/ally-guide/Pill";
import { en } from "@constants";
import { DebriefTenantRow } from "@types";
import { getErrorMessage } from "@utils";

import { ConsoleTable } from "./consoleTable";

/** Organisations: the per-organisation switch between today's debrief and the new one. */
export const OrganisationsTab: React.FC = () => {
  const s = en.debriefs.organisations;
  const tenants = useGetDebriefTenantsQuery();
  const [setLive, { isLoading }] = useSetDebriefTenantLiveMutation();
  const [target, setTarget] = useState<DebriefTenantRow | null>(null);
  const [setRegion, { isLoading: savingRegion }] = useSetDebriefTenantRegionMutation();

  const toggleRegion = async (t: DebriefTenantRow) => {
    try {
      await setRegion({
        tenantId: t.id,
        region: t.region === "india" ? "outside_india" : "india",
      }).unwrap();
      toast.success(s.saved);
    } catch (e) {
      toast.error(getErrorMessage(e, s.failed));
    }
  };
  // v9 FR-25: outside India there is no default line to fall back on.
  const blocked = (t: DebriefTenantRow) =>
    !t.live && t.region === "outside_india" && !t.hasSupportContact;

  const confirm = async () => {
    if (!target) return;
    try {
      await setLive({ tenantId: target.id, live: !target.live }).unwrap();
      toast.success(s.saved);
      setTarget(null);
    } catch (e) {
      toast.error(getErrorMessage(e, s.failed));
    }
  };

  return (
    <div className="flex flex-col gap-6" data-testid="organisations-tab">
      <div>
        <h2 className="text-xl font-normal text-typography-900">{s.heading}</h2>
        <p className="max-w-3xl pt-1 text-sm text-typography-700">{s.help}</p>
      </div>
      {tenants.isError ? (
        <ErrorPanel
          what={s.loadFailed}
          error={tenants.error}
          onRetry={() => void tenants.refetch()}
        />
      ) : !tenants.data ? (
        <LoadingBlock lines={5} />
      ) : (
        <ConsoleTable
          testId="organisations-table"
          headers={[s.columns.name, s.columns.state, s.columns.spend, s.columns.region, ""]}
          rows={tenants.data.map(t => ({
            key: t.id,
            testId: "organisation-row",
            cells: [
              <span key="n" className="flex items-center gap-2">
                {t.name}
                {t.isTest && <Pill tone="neutral">{s.test}</Pill>}
              </span>,
              <Pill key="s" tone={t.live ? "success" : "neutral"}>
                {t.live ? s.newDebrief : s.todays}
              </Pill>,
              <span key="c" className="text-sm" data-testid="organisation-spend">
                {s.spendLine(formatUsd(t.monthSpentUsd ?? 0), t.monthRuns ?? 0)}
              </span>,
              <span key="r" className="flex flex-wrap items-center gap-2">
                {t.region === "india" ? s.india : s.outsideIndia}
                {t.region === "outside_india" && !t.hasSupportContact && (
                  <Pill tone="warning">{s.noSupportLine}</Pill>
                )}
                <Button
                  kind="ghost"
                  size="sm"
                  disabled={savingRegion}
                  onClick={() => void toggleRegion(t)}
                >
                  {t.region === "india" ? s.markOutside : s.markIndia}
                </Button>
              </span>,
              <span key="b" className="flex flex-col items-start gap-1">
                <Button
                  kind="tertiary"
                  size="sm"
                  disabled={blocked(t)}
                  onClick={() => setTarget(t)}
                >
                  {t.live ? s.switchOff : s.switchOn}
                </Button>
                {blocked(t) && (
                  <span className="max-w-xs text-xs text-typography-700">{s.needsSupportLine}</span>
                )}
              </span>,
            ],
          }))}
        />
      )}
      <ConfirmDialog
        isOpen={target !== null}
        title={target ? (target.live ? s.offTitle(target.name) : s.onTitle(target.name)) : ""}
        cancelLabel={s.cancel}
        confirmLabel={target?.live ? s.switchOff : s.switchOn}
        danger={target?.live}
        isWorking={isLoading}
        onConfirm={() => void confirm()}
        onClose={() => setTarget(null)}
      >
        <p>{target?.live ? s.offBody : s.onBody}</p>
      </ConfirmDialog>
    </div>
  );
};
