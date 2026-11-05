import { FC, ReactNode } from "react";

import { Button, Tag } from "@ally-ui-mono/ui-shared";
import { AndroidProductionStatusResponse, MobileReleaseRun } from "@types";
import { formatDateTime } from "@utils";

import {
  getAndroidProductionStatusDisplay,
  getMobileReleaseRunStatusDisplay,
  MobileReleaseStatusDisplay,
} from "../mobileReleaseStatus";

interface AndroidReleasePipelineProps {
  androidVersionName?: string | null;
  androidVersionCode?: number | null;
  /** Most recent "Promote Android" run, any outcome — a still-running or failed attempt matters too. */
  lastPromoteRun?: MobileReleaseRun | null;
  /** Live Play Developer API production-track state — see AndroidProductionStatusResponse's own doc comment for what "completed" does and doesn't guarantee. */
  productionStatus?: AndroidProductionStatusResponse;
  isProductionStatusLoading: boolean;
  isProductionStatusError: boolean;
  currentMinAndroidVersion?: string | null;
  isMinAndroidVersionLoading: boolean;
  onUpdateMinVersion: () => void;
}

interface Stage {
  title: string;
  tag: MobileReleaseStatusDisplay;
  date?: string | null;
  description: ReactNode;
  action?: ReactNode;
}

/**
 * Android's release lifecycle as a timeline, same idea as IosReleasePipeline. "Publish" now
 * reads the real Play Developer API production-track state (see getAndroidProductionStatusDisplay)
 * instead of the static placeholder this used to show — but stays honest about what that signal
 * actually proves: `status: 'completed'` only means genuinely live to every user once Managed
 * Publishing is off for this app; with it on, this can still read "completed" while Google is
 * still holding the change for review or a manual publish click.
 *
 * No "Build" stage: that used to read the last successful "Android Build" GitHub Actions run
 * (RN's build-android-production.yml, kept alive in ally-mobile-rn-archive/ for a possible
 * rollback), deleted along with that folder in the 2026-11 Flutter rename. Flutter's own build
 * workflow isn't tracked by this run-history mechanism at all, so there's no equivalent "build
 * finished uploading" timestamp to show — androidVersionName/Code (from pubspec.yaml) is the
 * only signal this page has that a build exists.
 */
export const AndroidReleasePipeline: FC<AndroidReleasePipelineProps> = ({
  androidVersionName,
  androidVersionCode,
  lastPromoteRun,
  productionStatus,
  isProductionStatusLoading,
  isProductionStatusError,
  currentMinAndroidVersion,
  isMinAndroidVersionLoading,
  onUpdateMinVersion,
}) => {
  if (!androidVersionName) {
    return <p className="text-sm text-typography-700">No Android version information yet.</p>;
  }

  // The production track's release only counts as being "for" the current build if its
  // versionCodes actually include this build's versionCode — unlike the promote-run check above,
  // this is an exact match against real Play Developer API data, not a timestamp guess.
  const isProductionStatusForCurrentBuild =
    !!androidVersionCode && !!productionStatus?.versionCodes.includes(androidVersionCode);
  const isFullyRolledOut =
    isProductionStatusForCurrentBuild && productionStatus?.status === "completed";

  const isMinVersionCurrent = currentMinAndroidVersion === androidVersionName;

  // Without a tracked build-run to correlate against (see class doc above), this can only say
  // "a promote run exists", not "...for this specific version" — a promote of an older version
  // would still show here as if it were current. Harmless: this stage is informational, nothing
  // blocks on it.
  const promoteStage: Stage = lastPromoteRun
    ? {
        title: "Promote to Production",
        tag: getMobileReleaseRunStatusDisplay(lastPromoteRun.status, lastPromoteRun.conclusion),
        date: lastPromoteRun.runStartedAt,
        description:
          lastPromoteRun.conclusion === "success"
            ? "Submitted to Google for review. See the Publish stage below for the real production-track state."
            : lastPromoteRun.status === "completed"
              ? "The last promotion attempt didn't succeed — see Release History for details."
              : "Promotion is running now.",
      }
    : {
        title: "Promote to Production",
        tag: { type: "cool-gray", label: "Not yet promoted" },
        description: "This build hasn't been promoted to the production track yet.",
      };

  const publishStage: Stage = isProductionStatusLoading
    ? {
        title: "Publish",
        tag: { type: "cool-gray", label: "Loading…" },
        description: "Checking the Play Developer API production track…",
      }
    : isProductionStatusError
      ? {
          title: "Publish",
          tag: { type: "cool-gray", label: "Unknown" },
          description: "Couldn't read the production track status — check Play Console directly.",
        }
      : !isProductionStatusForCurrentBuild || !productionStatus
        ? {
            title: "Publish",
            tag: { type: "cool-gray", label: "Not yet" },
            description:
              "This build isn't reflected on the production track yet — either it hasn't been promoted, or Google hasn't picked up the change.",
          }
        : {
            title: "Publish",
            tag: getAndroidProductionStatusDisplay(
              productionStatus.status,
              productionStatus.userFraction,
            ),
            description:
              productionStatus.status === "completed"
                ? "The production track shows this build at 100% rollout. If Managed Publishing is off in Play Console, that means it's genuinely live — if it's still on, confirm in Play Console, since a committed release can still be held pending review or a manual Publish click."
                : productionStatus.status === "inProgress"
                  ? "Only reaching a portion of users right now — not everyone can download it yet."
                  : productionStatus.status === "halted"
                    ? "The staged rollout was paused — check Play Console for why."
                    : "Not yet rolled out to any users.",
          };

  const stages: Stage[] = [
    promoteStage,
    publishStage,
    {
      title: "Update Minimum Version",
      tag: isMinVersionCurrent
        ? { type: "green", label: "Up to date" }
        : isFullyRolledOut
          ? { type: "blue", label: "Ready" }
          : { type: "cool-gray", label: "Not yet" },
      description: isMinAndroidVersionLoading ? (
        "Loading current threshold…"
      ) : isMinVersionCurrent ? (
        `The force-update minimum is already ${currentMinAndroidVersion}.`
      ) : isFullyRolledOut ? (
        <>
          The production track shows {androidVersionName} fully rolled out. Once you've confirmed
          that in Play Console — especially if Managed Publishing is still on — you can raise the
          minimum version to match.
        </>
      ) : (
        `Current minimum is ${currentMinAndroidVersion ?? "unknown"} — raise it to ${androidVersionName} only once you've confirmed that version is actually published and live on the Play Store.`
      ),
      action: !isMinVersionCurrent ? (
        <Button kind="tertiary" size="sm" onClick={onUpdateMinVersion}>
          Update Minimum Version
        </Button>
      ) : undefined,
    },
  ];

  return (
    <div className="flex flex-col">
      {stages.map((stage, index) => (
        <div key={stage.title} className="flex gap-3">
          <div className="flex flex-col items-center">
            <div className="w-6 h-6 shrink-0 rounded-full border-2 border-primary-300 bg-white flex items-center justify-center text-xs text-primary-500 font-medium">
              {index + 1}
            </div>
            {index < stages.length - 1 && <div className="w-px flex-1 bg-border-light my-1" />}
          </div>
          <div className={`min-w-0 flex-1 ${index < stages.length - 1 ? "pb-4" : ""}`}>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium text-typography-900">{stage.title}</p>
                <Tag type={stage.tag.type} size="sm">
                  {stage.tag.label}
                </Tag>
              </div>
              {stage.date && (
                <span className="text-xs text-typography-600 whitespace-nowrap">
                  {formatDateTime(stage.date)}
                </span>
              )}
            </div>
            <p className="text-sm text-typography-700 mt-1">{stage.description}</p>
            {stage.action && <div className="mt-2">{stage.action}</div>}
          </div>
        </div>
      ))}
    </div>
  );
};
