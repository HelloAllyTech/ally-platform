import { FC } from "react";

import { IosTestflightHistoryEntry } from "@types";

import { TestflightHistoryTable } from "../components/TestflightHistoryTable";

interface IosTestflightTabProps {
  currentBuildId?: string | null;
  testflightHistory: IosTestflightHistoryEntry[];
  isTestflightHistoryLoading: boolean;
  isTestflightHistoryError: boolean;
}

/**
 * The current build's own pipeline (Submit for Distribution → Update Minimum
 * Version) already lives in the always-visible Release Overview above the
 * tabs — repeating it here would just be the same component twice on one
 * page. This tab is for what's genuinely specific to it: the full TestFlight
 * submission history.
 *
 * Used to also show raw "iOS Build" GitHub Actions run history below that —
 * RN's build-ios-production.yml, deleted along with ally-mobile-rn-archive/
 * in the 2026-11 Flutter rename. There is no Flutter-build equivalent
 * tracked by this run-history mechanism, so that section was removed rather
 * than left permanently empty.
 */
export const IosTestflightTab: FC<IosTestflightTabProps> = ({
  currentBuildId,
  testflightHistory,
  isTestflightHistoryLoading,
  isTestflightHistoryError,
}) => (
  <div>
    <h3 className="text-sm font-medium text-typography-900 mb-2">TestFlight submission history</h3>
    <TestflightHistoryTable
      history={testflightHistory}
      isLoading={isTestflightHistoryLoading}
      isError={isTestflightHistoryError}
      currentBuildId={currentBuildId}
    />
  </div>
);
