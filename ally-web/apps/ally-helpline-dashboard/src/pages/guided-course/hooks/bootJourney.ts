/**
 * How the journey starts, as one async function over injected calls so every
 * outcome is testable: bootstrap when the server has it, otherwise the
 * pre-bootstrap endpoints, and the thread is created on first visit. Every
 * refusal ends in a designed state; anything unexpected is `error`, which
 * the page shows with a way back to classic (it fails closed).
 */
import type { TrackAccessDenialReason, TrackAccessResponse, TrackDetail } from "@types";

import {
  composeBootstrap,
  fromBootstrapWire,
  GuideBootstrapWire,
  GuidanceLevel,
  JourneyAvailability,
  JourneyBootstrap,
  JourneyThread,
} from "../contract/bootstrap";
import { errorCodeOf, statusOf } from "../state/failureStates";

export interface BootDeps {
  isSignedIn: () => boolean;
  getBootstrap: (trackId: string) => Promise<GuideBootstrapWire>;
  getAvailability: (trackId: string) => Promise<Partial<JourneyAvailability>>;
  getAccess: (trackId: string) => Promise<TrackAccessResponse>;
  getDetail: (trackId: string) => Promise<TrackDetail>;
  openThread: (trackId: string) => Promise<JourneyThread>;
  /** The dial setting remembered on this device, until prefs come from the server. */
  localGuidance?: () => GuidanceLevel | null;
}

export type BootOutcome =
  | { kind: "ready"; bootstrap: JourneyBootstrap }
  | { kind: "denied"; reason: TrackAccessDenialReason | null }
  | { kind: "disabled" }
  | { kind: "unavailable" }
  | { kind: "signed_out" }
  | { kind: "error" };

const refusal = (error: unknown): BootOutcome | null => {
  const code = errorCodeOf(error);
  if (code === "GUIDE_DISABLED") return { kind: "disabled" };
  if (code === "GUIDE_NO_ACCESS") return { kind: "denied", reason: null };
  return null;
};

/** A denial's reason comes from the classic access check (build log, departure 6). */
const deniedWithReason = async (trackId: string, deps: BootDeps): Promise<BootOutcome> => {
  try {
    const access = await deps.getAccess(trackId);
    return { kind: "denied", reason: access.reason };
  } catch {
    return { kind: "denied", reason: null };
  }
};

const withThread = async (
  trackId: string,
  bootstrap: JourneyBootstrap,
  deps: BootDeps,
): Promise<BootOutcome> => {
  if (bootstrap.thread) return { kind: "ready", bootstrap };
  try {
    const thread = await deps.openThread(trackId);
    return { kind: "ready", bootstrap: { ...bootstrap, thread } };
  } catch (error) {
    const refused = refusal(error);
    if (refused?.kind === "denied") return deniedWithReason(trackId, deps);
    return refused ?? { kind: "error" };
  }
};

const composed = async (trackId: string, deps: BootDeps): Promise<BootOutcome> => {
  let availability: Partial<JourneyAvailability>;
  try {
    availability = await deps.getAvailability(trackId);
  } catch (error) {
    return statusOf(error) === 404 ? { kind: "unavailable" } : { kind: "error" };
  }
  if (availability.guided !== true) return { kind: "disabled" };

  let access: TrackAccessResponse;
  try {
    access = await deps.getAccess(trackId);
  } catch (error) {
    return statusOf(error) === 404 ? { kind: "unavailable" } : { kind: "error" };
  }
  if (!access.hasAccess) return { kind: "denied", reason: access.reason };

  let detail: TrackDetail;
  try {
    detail = await deps.getDetail(trackId);
  } catch (error) {
    const status = statusOf(error);
    return status === 404 || status === 400 ? { kind: "unavailable" } : { kind: "error" };
  }

  return withThread(
    trackId,
    composeBootstrap({
      trackId,
      availability,
      access: { hasAccess: true, enrolled: access.enrolled, reason: null },
      thread: null,
      detail,
      guidance: deps.localGuidance?.() ?? null,
    }),
    deps,
  );
};

export const bootJourney = async (trackId: string, deps: BootDeps): Promise<BootOutcome> => {
  if (!trackId) return { kind: "unavailable" };
  if (!deps.isSignedIn()) {
    // Visitors (anonymous chat) arrive in M2; until then, sign in first.
    try {
      const availability = await deps.getAvailability(trackId);
      return availability.guided === true ? { kind: "signed_out" } : { kind: "disabled" };
    } catch {
      return { kind: "disabled" };
    }
  }

  let wire: GuideBootstrapWire;
  try {
    wire = await deps.getBootstrap(trackId);
  } catch (error) {
    const refused = refusal(error);
    if (refused?.kind === "denied") return deniedWithReason(trackId, deps);
    if (refused) return refused;
    // An older backend has no bootstrap route: build the same view by hand.
    if (statusOf(error) === 404) return composed(trackId, deps);
    return { kind: "error" };
  }

  const bootstrap = fromBootstrapWire(trackId, wire);
  if (!bootstrap.availability.guided) return { kind: "disabled" };
  if (!bootstrap.access.hasAccess) return { kind: "denied", reason: bootstrap.access.reason };
  if (!wire.prefs?.guidance) {
    const local = deps.localGuidance?.();
    if (local) bootstrap.prefs = { guidance: local };
  }
  return withThread(trackId, bootstrap, deps);
};
