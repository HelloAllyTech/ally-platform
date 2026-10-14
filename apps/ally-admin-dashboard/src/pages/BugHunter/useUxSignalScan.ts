import { useEffect, useState } from "react";

import { useDispatch, useSelector } from "react-redux";
import { toast } from "sonner";

import { baseAPI, useGetUxSignalScansQuery, useScanUxSignalsMutation } from "@api";
import { en, FeatureToggleKey, TAG_TYPES } from "@constants";
import { RootState } from "@store";
import { UxSignalScan, UxSignalScanStatus } from "@types";
import { hasFeature } from "@utils";

/**
 * How often the hook asks the scan log whether the run it is following has
 * finished. A scan takes about two minutes, so this is roughly two dozen cheap
 * reads across one run — frequent enough that "finished" and "the page said so"
 * are the same moment to a reader, and idle the rest of the time.
 */
export const UX_SCAN_POLL_INTERVAL_MS = 5_000;

/**
 * Mirrors UX_SIGNAL_SCHEDULE.STALE_RUNNING_MINUTES in ally-be. A RUNNING row
 * older than this is one the backend will treat as abandoned, so the hook stops
 * waiting on it at the same point rather than polling a dead row forever.
 */
const STALE_RUNNING_MS = 15 * 60_000;

const fill = (template: string, values: Record<string, string | number>): string =>
  Object.entries(values).reduce(
    (text, [key, value]) => text.replace(`{${key}}`, String(value)),
    template,
  );

/** What a finished scan says, as a toast. */
const announce = (scan: UxSignalScan) => {
  const strings = en.uxSignals;
  if (scan.status !== UxSignalScanStatus.COMPLETED) {
    toast.error(
      fill(strings.scanFailedReason, { reason: scan.error ?? strings.scanUnknownReason }),
    );
    return;
  }
  const title = fill(strings.scanDone, {
    findings: scan.findingsCreated,
    suggestions: scan.suggestionsCreated,
  });
  const description = [
    fill(strings.scanDetail, { signals: scan.signalsDetected, skipped: scan.skippedDuplicates }),
    scan.failedDetectors.length > 0
      ? fill(strings.detectorsFailed, { detectors: scan.failedDetectors.join(", ") })
      : null,
  ]
    .filter(Boolean)
    .join(" ");
  if (scan.failedDetectors.length > 0) toast.warning(title, { description });
  else toast.success(title, { description });
};

export interface UxSignalScanControl {
  /** False without the UX_SIGNALS toggle — the caller offers nothing at all then. */
  canScan: boolean;
  /** From the click until the result lands, not just while the POST is in flight. */
  isBusy: boolean;
  /** "Last scan …", in words — what the menu shows under its item. */
  lastScanLine: string;
  runScan: () => Promise<void>;
}

/**
 * The UX Signals scan, as a control the page header can hold.
 *
 * ## Why it left the Work tab (2026-10-13)
 *
 * It was a full-width bar above the bugs table — a name, the last-scan line
 * and a button — read once and then scrolled past every day on the way to the
 * table, for a scan that runs itself nightly. The trigger moved into the
 * header's overflow menu with its last-scan line beside it, and what the bar
 * used to print inline when a scan finished became a toast.
 *
 * ## Why the result is read from the scan log rather than the button press
 *
 * Starting a scan and finishing one are minutes apart, so they are two events
 * and this treats them as two. The POST answers in milliseconds with "it is
 * running"; the outcome is read by polling the scan log. The shape before that
 * — one request held open for the whole run — told an admin in production that
 * the scan "could not be completed. Nothing was filed" while it went on to file
 * seven findings.
 *
 * It follows whichever scan the log says is running, so it reports the one an
 * admin started from another tab too. It only toasts a scan it saw running,
 * though: a nightly scan that finished hours before the page opened is the
 * last-scan line's to report, not a pop-up's.
 *
 * Zero counts are a real, successful result — a quiet week, or everything found
 * was already filed — and the toast says so, which is what stops the next
 * reader pressing the button again to check.
 */
export const useUxSignalScan = (): UxSignalScanControl => {
  const strings = en.uxSignals;
  const dispatch = useDispatch();
  const features = useSelector((state: RootState) => state.user.features);
  const canScan = hasFeature(features, FeatureToggleKey.UX_SIGNALS);

  const [watchedScanId, setWatchedScanId] = useState<string | null>(null);
  const [pollMs, setPollMs] = useState(0);
  const [start, { isLoading: isStarting }] = useScanUxSignalsMutation();

  // Only fetched for readers who may scan — for anyone else nothing renders,
  // so the request would be wasted.
  const { data } = useGetUxSignalScansQuery(
    { limit: 1 },
    { skip: !canScan, pollingInterval: pollMs },
  );
  const lastScan = data?.scans?.[0];

  const isRunning = lastScan?.status === UxSignalScanStatus.RUNNING;
  const hasStalled =
    isRunning && Date.now() - new Date(lastScan.startedAt).getTime() > STALE_RUNNING_MS;

  // Follow whatever is running, however it was started, and stop the moment
  // there is nothing live to follow — a stalled row included, since the backend
  // has given up on it too and polling it would never end.
  useEffect(() => {
    if (isRunning && !hasStalled) {
      setWatchedScanId(lastScan.id);
      setPollMs(UX_SCAN_POLL_INTERVAL_MS);
    } else {
      setPollMs(0);
      if (hasStalled) setWatchedScanId(null);
    }
  }, [isRunning, hasStalled, lastScan?.id]);

  // Report the run we were following, once it lands.
  useEffect(() => {
    if (!lastScan || lastScan.id !== watchedScanId) return;
    if (lastScan.status === UxSignalScanStatus.RUNNING) return;

    setWatchedScanId(null);
    announce(lastScan);

    // The findings and suggestions exist *now*, which is why the invalidation is
    // here and not on the mutation: at the moment the scan was started there was
    // nothing new to fetch.
    if (lastScan.status === UxSignalScanStatus.COMPLETED) {
      dispatch(
        baseAPI.util.invalidateTags([
          { type: TAG_TYPES.BUG_HUNTER_FINDINGS, id: "LIST" },
          { type: TAG_TYPES.ANALYTICS_SUGGESTIONS, id: "LIST" },
        ]),
      );
    }
  }, [lastScan, watchedScanId, dispatch]);

  const runScan = async () => {
    try {
      const started = await start().unwrap();
      // Claim the id from the response rather than waiting for the log to show
      // it: this is what keeps the item disabled across the gap between the
      // scan existing and the next poll noticing.
      setWatchedScanId(started.scanId);
      setPollMs(UX_SCAN_POLL_INTERVAL_MS);
      // Said once, so a two-minute wait with nothing on screen doesn't read as
      // a click that did nothing.
      toast.info(strings.scanning, { description: strings.scanTooltip });
    } catch (caught) {
      // A 409 or a missing PostHog credential is something the reader has to
      // act on, so the backend's own reason is shown rather than replaced.
      const status = (caught as { status?: number })?.status;
      const detail = (caught as { data?: { message?: string } })?.data?.message;
      toast.error(
        status === 409
          ? strings.scanConflict
          : status === 503
            ? (detail ?? strings.scanUnavailable)
            : (detail ?? strings.scanFailed),
      );
    }
  };

  const lastScanLine = (() => {
    if (!lastScan) return strings.neverScanned;
    const when = new Date(lastScan.startedAt).toLocaleString();
    if (hasStalled) return fill(strings.scanStalled, { when });
    if (lastScan.status === UxSignalScanStatus.RUNNING) return strings.scanRunning;
    if (lastScan.status === UxSignalScanStatus.FAILED) {
      return fill(strings.lastScanFailed, {
        when,
        reason: lastScan.error ?? strings.scanUnknownReason,
      });
    }
    return fill(strings.lastScanSummary, {
      when,
      findings: lastScan.findingsCreated,
      suggestions: lastScan.suggestionsCreated,
    });
  })();

  // Busy from the click until the result lands: the request returns in
  // milliseconds and the scan runs for two minutes, so `isStarting` alone would
  // re-enable the item almost immediately and invite a press that can only 409.
  const isBusy = isStarting || Boolean(watchedScanId) || (isRunning && !hasStalled);

  return { canScan, isBusy, lastScanLine, runScan };
};
