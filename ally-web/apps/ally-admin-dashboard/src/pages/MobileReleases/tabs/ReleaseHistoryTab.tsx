import { FC } from "react";

import { MobileReleaseRun } from "@types";

import { RunsTable } from "../components/RunsTable";

interface ReleaseHistoryTabProps {
  runs: MobileReleaseRun[];
  isRunsLoading: boolean;
  isRunsFetching: boolean;
  isRunsError: boolean;
}

/**
 * Every run from every tracked release workflow, unfiltered — the detailed record behind the
 * summarised platform tabs. Only Android promotion and iOS App Store review submission runs are
 * tracked here (see MobileReleaseWorkflowName's own comment) — there's no Flutter-build
 * equivalent, and RN's build/scheduled-check workflows were deleted in the 2026-11 rename.
 */
export const ReleaseHistoryTab: FC<ReleaseHistoryTabProps> = ({
  runs,
  isRunsLoading,
  isRunsFetching,
  isRunsError,
}) => {
  return (
    <div>
      <p className="text-sm text-typography-700 mb-3">
        Every Android promotion and iOS App Store review submission run, newest first.
      </p>
      <RunsTable
        runs={runs}
        isLoading={isRunsLoading}
        isError={isRunsError}
        isFetching={isRunsFetching}
        emptyTitle="No runs yet"
        emptySubtitle="The release pipeline hasn't run yet — check back after its next scheduled pass."
      />
    </div>
  );
};
