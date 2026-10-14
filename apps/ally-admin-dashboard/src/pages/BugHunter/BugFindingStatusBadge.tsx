import React, { useEffect, useRef, useState } from "react";

import { BugFindingStatus } from "@types";

import { BUG_FINDING_STATUS_LABELS } from "./bugFindingLabels";

/** Matches `fadeInOut`'s configured duration in tailwind.config.js — the class loops infinite, so the flash is capped to one cycle by removing it after this long. */
const STATUS_FLASH_DURATION_MS = 1500;

/**
 * Four meanings, and only four (2026-10-13):
 *
 * - **orange** — needs you: pending your approval, or waiting on your answer;
 * - **red** — went red: a failed fix or a failed release;
 * - **green** — live: users have the fix;
 * - **grey** — everything else, including every state in which Bug Hunter is
 *   working. Working is said by the spinner the table puts beside the badge,
 *   not by a colour.
 *
 * Amber used to mean both "waiting on you" (Pending approval) and "agent
 * working" (Fixing, Starting…, Releasing…), and blue and pale green meant
 * "somewhere in between". Seven tints for seventeen statuses made colour
 * something to decode rather than something to scan — the opposite of
 * Stacks' *Dynamic visibility scaling tied to information urgency*: quiet when
 * normal, loud only when it needs acting on.
 */
const NEEDS_YOU = "bg-orange-50 text-orange-700 border-orange-200";
const FAILED = "bg-destructive-50 text-destructive-700 border-destructive-200";
const LIVE = "bg-green-600 text-white border-green-600";
const NEUTRAL = "bg-neutral-100 text-typography-700 border-border-light";

const STYLES: Record<BugFindingStatus, string> = {
  [BugFindingStatus.PENDING_APPROVAL]: NEEDS_YOU,
  [BugFindingStatus.NEEDS_INPUT]: NEEDS_YOU,
  [BugFindingStatus.FAILED]: FAILED,
  [BugFindingStatus.RELEASE_FAILED]: FAILED,
  [BugFindingStatus.RELEASED]: LIVE,
  [BugFindingStatus.NEW]: NEUTRAL,
  [BugFindingStatus.APPROVED]: NEUTRAL,
  [BugFindingStatus.QUEUED]: NEUTRAL,
  [BugFindingStatus.BLOCKED]: NEUTRAL,
  [BugFindingStatus.COORDINATING]: NEUTRAL,
  [BugFindingStatus.FIXING]: NEUTRAL,
  [BugFindingStatus.PR_OPENED]: NEUTRAL,
  [BugFindingStatus.MERGED]: NEUTRAL,
  [BugFindingStatus.RELEASING]: NEUTRAL,
  [BugFindingStatus.DISMISSED]: NEUTRAL,
  [BugFindingStatus.REJECTED]: NEUTRAL,
  // A human stopped this on purpose; it didn't give up on its own.
  [BugFindingStatus.CANCELLED]: NEUTRAL,
};

/**
 * The status pill, plus a one-cycle flash whenever `status` actually changes
 * (not on mount — a table full of badges shouldn't flash on first load, only
 * a row that just moved).
 */
export const BugFindingStatusBadge: React.FC<{ status: BugFindingStatus }> = ({ status }) => {
  const [flash, setFlash] = useState(false);
  const hasMountedRef = useRef(false);
  const prevStatusRef = useRef(status);

  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      prevStatusRef.current = status;
      return undefined;
    }
    if (prevStatusRef.current === status) return undefined;
    prevStatusRef.current = status;
    setFlash(true);
    const timer = setTimeout(() => setFlash(false), STATUS_FLASH_DURATION_MS);
    return () => clearTimeout(timer);
  }, [status]);

  return (
    <span
      className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full border ${
        STYLES[status]
      } ${flash ? "animate-fadeInOut motion-reduce:animate-none" : ""}`}
    >
      {BUG_FINDING_STATUS_LABELS[status]}
    </span>
  );
};
