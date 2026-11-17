import { useCallback, useEffect } from "react";

import { ANALYTICS_EVENTS, ANALYTICS_PROPS, captureEvent } from "@ally-ui-mono/ui-shared";

import { useRoadmapRole } from "../RoadmapGate";

/**
 * The §4.16 core jobs, one `roadmap_job_started` / `roadmap_job_completed` pair each (P8). Where
 * each starts and ends is in plans/roadmap-v2-build/P8-NOTES.md; the medians live in PostHog.
 */
export type RoadmapJob =
  | "find_my_idea"
  | "capture_idea"
  | "draft_to_submitted"
  | "answer_from_notification"
  | "triage_one"
  | "settle_answers"
  | "brief_to_claude_code";

/**
 * Jobs timed per idea: their clock is keyed by the idea's code, so two ideas never share one.
 * The others have one clock each (finding your idea, capturing a new one).
 */
const PER_ITEM: Record<RoadmapJob, boolean> = {
  find_my_idea: false,
  capture_idea: false,
  draft_to_submitted: true,
  answer_from_notification: true,
  triage_one: true,
  settle_answers: true,
  brief_to_claude_code: true,
};

/**
 * A start older than this is an abandoned attempt: its completion is not sent. Every target is
 * five minutes or less, so half an hour later is someone coming back, not the job taking long.
 */
export const JOB_STALE_AFTER_MS = 30 * 60_000;

/** Leaving the Roadmap for less than this (a route change between its pages) is not leaving. */
export const ROADMAP_ENTRY_GAP_MS = 2_000;

// Module state: the clocks must outlive a page, because a job crosses pages (Queue → idea).
const starts = new Map<string, number>();
const presence = { count: 0, leftAt: Number.NEGATIVE_INFINITY };

const keyOf = (job: RoadmapJob, itemId?: string | null): string =>
  PER_ITEM[job] ? `${job}:${(itemId ?? "").toUpperCase()}` : job;

/**
 * The clocks, without React or PostHog, for the hook and for tests. `start` returns whether a new
 * attempt began (so the hook sends `started` once per attempt); `complete` returns the duration,
 * or null when nothing (fresh) was running.
 */
export const jobClock = {
  start(job: RoadmapJob, itemId: string | null | undefined, now: number, restart = false) {
    const key = keyOf(job, itemId);
    const running = starts.get(key);
    if (!restart && running !== undefined && now - running < JOB_STALE_AFTER_MS) return false;
    starts.set(key, now);
    return true;
  },
  complete(job: RoadmapJob, itemId: string | null | undefined, now: number): number | null {
    const key = keyOf(job, itemId);
    const running = starts.get(key);
    if (running === undefined) return null;
    starts.delete(key);
    const ms = now - running;
    if (ms < 0 || ms >= JOB_STALE_AFTER_MS) return null;
    return ms;
  },
  isRunning(job: RoadmapJob, itemId: string | null | undefined, now: number): boolean {
    const running = starts.get(keyOf(job, itemId));
    return running !== undefined && now - running < JOB_STALE_AFTER_MS;
  },
  reset() {
    starts.clear();
    presence.count = 0;
    presence.leftAt = Number.NEGATIVE_INFINITY;
  },
};

/**
 * Whether the page asking was reached from outside the Roadmap ("Roadmap open"), not by moving
 * between its own pages. Called from a page's effect: by then a frame that unmounted on the way
 * has already stamped `leftAt`, and a frame that stayed is still counted.
 */
export const isRoadmapEntry = (now: number = Date.now()): boolean =>
  presence.count === 0 && now - presence.leftAt > ROADMAP_ENTRY_GAP_MS;

/** RoadmapFrame calls this, so the timer knows when someone is inside the Roadmap. */
export const useRoadmapPresence = (): void => {
  useEffect(() => {
    presence.count += 1;
    return () => {
      presence.count = Math.max(0, presence.count - 1);
      if (presence.count === 0) presence.leftAt = Date.now();
    };
  }, []);
};

interface JobOptions {
  /** The idea's code: the clock's key for per-idea jobs, and `item_id` on the event. */
  itemId?: string | null;
  /** Start a fresh attempt even if one is running (a new focus, a new open). */
  restart?: boolean;
}

/**
 * Time the §4.16 jobs (P8). `start` begins an attempt (a running, fresh one is kept unless
 * `restart`); `complete` sends the duration of the running attempt and stops it, and does nothing
 * when none is running, so an abandoned start simply has no completion.
 *
 * Calls `captureEvent` directly rather than `useAnalytics()`: the clock is driven from callbacks
 * and pages that render outside the analytics provider in tests, and the Roadmap role, not the
 * platform role, is what these events are split by. Sends ids, the role and numbers only.
 */
export const useRoadmapJobTimer = () => {
  const { role } = useRoadmapRole();

  const start = useCallback(
    (job: RoadmapJob, options: JobOptions = {}) => {
      if (!jobClock.start(job, options.itemId, Date.now(), options.restart)) return;
      captureEvent(ANALYTICS_EVENTS.ROADMAP_JOB_STARTED, {
        [ANALYTICS_PROPS.ROADMAP_JOB]: job,
        [ANALYTICS_PROPS.ROADMAP_ROLE]: role,
        ...(options.itemId ? { [ANALYTICS_PROPS.ITEM_ID]: options.itemId } : {}),
      });
    },
    [role],
  );

  const complete = useCallback(
    (job: RoadmapJob, options: Pick<JobOptions, "itemId"> = {}) => {
      const durationMs = jobClock.complete(job, options.itemId, Date.now());
      if (durationMs === null) return;
      captureEvent(ANALYTICS_EVENTS.ROADMAP_JOB_COMPLETED, {
        [ANALYTICS_PROPS.ROADMAP_JOB]: job,
        [ANALYTICS_PROPS.ROADMAP_ROLE]: role,
        [ANALYTICS_PROPS.DURATION_MS]: Math.round(durationMs),
        ...(options.itemId ? { [ANALYTICS_PROPS.ITEM_ID]: options.itemId } : {}),
      });
    },
    [role],
  );

  return { start, complete };
};
