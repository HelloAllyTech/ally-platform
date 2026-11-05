import { FC } from "react";

import { MobileReleaseRun } from "@types";

import { RunsTable } from "../components/RunsTable";

interface AndroidReleasesTabProps {
  runs: MobileReleaseRun[];
  isRunsLoading: boolean;
  isRunsFetching: boolean;
  isRunsError: boolean;
}

/**
 * "Android Build" runs no longer exist to filter for: that was RN's
 * build-android-production.yml, deleted along with ally-mobile-rn-archive/
 * in the 2026-11 Flutter rename. There is no Flutter-build equivalent
 * tracked by this run-history mechanism, so this tab is promotion runs only.
 */
export const AndroidReleasesTab: FC<AndroidReleasesTabProps> = ({
  runs,
  isRunsLoading,
  isRunsFetching,
  isRunsError,
}) => {
  const androidRuns = runs.filter(run => run.workflowName === "Promote Android");

  return (
    <div>
      <p className="text-sm text-typography-700 mb-3">
        Every production-promotion run, newest first.
      </p>
      <RunsTable
        runs={androidRuns}
        isLoading={isRunsLoading}
        isError={isRunsError}
        isFetching={isRunsFetching}
        emptyTitle="No Android promotion runs yet"
        emptySubtitle="No Android build has been promoted to production yet."
      />
    </div>
  );
};
