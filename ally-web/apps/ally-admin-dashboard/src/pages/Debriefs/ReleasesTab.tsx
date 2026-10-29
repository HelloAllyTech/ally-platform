import React, { useState } from "react";

import { toast } from "sonner";

import { Button } from "@ally-ui-mono/ui-shared";
import { useGetDebriefReleasesQuery, useRollbackDebriefReleaseMutation } from "@api";
import { releaseVersionLabel } from "@components/ally-guide/allyGuideFormat";
import { ConfirmDialog } from "@components/ally-guide/ConfirmDialog";
import { EmptyPanel, ErrorPanel, LoadingBlock } from "@components/ally-guide/ConsoleStates";
import { Pill } from "@components/ally-guide/Pill";
import { en } from "@constants";
import { DebriefReleaseRow } from "@types";
import { getErrorMessage } from "@utils";

import { ConsoleTable, formatWhen } from "./consoleTable";

/** Releases: every version of the Debrief agent, and one-click rollback. */
export const ReleasesTab: React.FC = () => {
  const s = en.debriefs.releases;
  const releases = useGetDebriefReleasesQuery();
  const [rollback, { isLoading }] = useRollbackDebriefReleaseMutation();
  const [target, setTarget] = useState<DebriefReleaseRow | null>(null);

  const confirm = async () => {
    if (!target) return;
    try {
      await rollback({ id: target.id }).unwrap();
      toast.success(s.rolledBack);
      setTarget(null);
    } catch (e) {
      toast.error(getErrorMessage(e, en.debriefs.organisations.failed));
    }
  };

  return (
    <div className="flex flex-col gap-6" data-testid="releases-tab">
      <div>
        <h2 className="text-xl font-normal text-typography-900">{s.heading}</h2>
        <p className="max-w-3xl pt-1 text-sm text-typography-700">{s.help}</p>
      </div>
      {releases.isError ? (
        <ErrorPanel
          what={s.loadFailed}
          error={releases.error}
          onRetry={() => void releases.refetch()}
        />
      ) : !releases.data ? (
        <LoadingBlock lines={4} />
      ) : releases.data.length === 0 ? (
        <EmptyPanel title={s.heading} message={s.empty} />
      ) : (
        <ConsoleTable
          testId="releases-table"
          headers={[
            s.columns.version,
            s.columns.status,
            s.columns.by,
            s.columns.notes,
            s.columns.when,
            "",
          ]}
          rows={releases.data.map(r => ({
            key: r.id,
            testId: "release-row",
            cells: [
              releaseVersionLabel(r.version),
              r.status === "ga" ? (
                <Pill key="p" tone="success">
                  {s.live}
                </Pill>
              ) : (
                r.status
              ),
              s.authors[r.authorKind] ?? r.authorKind,
              r.notes ?? "—",
              formatWhen(r.promotedAt ?? r.createdAt),
              r.status === "ga" ? null : (
                <Button key="b" kind="tertiary" size="sm" onClick={() => setTarget(r)}>
                  {s.rollback}
                </Button>
              ),
            ],
          }))}
        />
      )}
      <ConfirmDialog
        isOpen={target !== null}
        title={target ? s.rollbackTitle(releaseVersionLabel(target.version)) : ""}
        cancelLabel={en.debriefs.improver.cancel}
        confirmLabel={s.rollbackConfirm}
        isWorking={isLoading}
        onConfirm={() => void confirm()}
        onClose={() => setTarget(null)}
      >
        <p>{s.rollbackBody}</p>
      </ConfirmDialog>
    </div>
  );
};
