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
  /** Enrols the learner through the thread (idempotent); first open only. */
  enroll?: (threadId: string) => Promise<unknown>;
  /** The dial setting remembered on this device, until prefs come from the server. */
  localGuidance?: () => GuidanceLevel | null;
  /** Anonymous visitors (M2). Without these, a signed-out visitor is asked to sign in. */
  visitor?: VisitorBootDeps;
  /** Signing in claims the visitor's conversation, once, with the stored token (plan §3 stage 3). */
  claim?: ClaimBootDeps;
}

export type ClaimOutcome = "claimed" | "merged" | "none";

export interface ClaimBootDeps {
  pendingToken: () => string | null;
  /** The signed-in `POST tracks/:trackId/threads` with the visitor token alongside. */
  claimThread: (trackId: string, token: string) => Promise<{ claim?: ClaimOutcome }>;
  dropToken: () => void;
}

export interface VisitorBootDeps {
  /** The stored token, or a new visit (`POST visitors`; 429 when this address has too many). */
  ensureToken: () => Promise<string>;
  dropToken: () => void;
  getBootstrap: (trackId: string, token: string) => Promise<GuideBootstrapWire>;
}

export type JourneyIdentity = "learner" | "visitor";

export type BootOutcome =
  | {
      kind: "ready";
      bootstrap: JourneyBootstrap;
      identity: JourneyIdentity;
      visitorToken?: string;
      /** What signing in did with the visitor conversation, when there was one to claim. */
      claim?: ClaimOutcome;
    }
  | {
      kind: "denied";
      reason: TrackAccessDenialReason | null;
      /** Refused while claiming: the visitor conversation is left as it was (plan §11 A-2). */
      claimRefused?: boolean;
    }
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

/**
 * Opening the journey is choosing the course: the thread is created on first
 * visit and the learner enrolled through it (plan §3 step 4). A failed
 * enrolment doesn't stop the journey: Start (or a `not_enrolled` turn)
 * tries again.
 */
const withThread = async (
  trackId: string,
  bootstrap: JourneyBootstrap,
  deps: BootDeps,
): Promise<BootOutcome> => {
  let thread = bootstrap.thread;
  if (!thread) {
    try {
      thread = await deps.openThread(trackId);
    } catch (error) {
      const refused = refusal(error);
      if (refused?.kind === "denied") return deniedWithReason(trackId, deps);
      return refused ?? { kind: "error" };
    }
  }
  let access = bootstrap.access;
  if (!access.enrolled && deps.enroll) {
    try {
      await deps.enroll(thread.id);
      access = { ...access, enrolled: true };
    } catch (error) {
      const refused = refusal(error);
      if (refused?.kind === "denied") return deniedWithReason(trackId, deps);
      if (refused) return refused;
    }
  }
  return { kind: "ready", bootstrap: { ...bootstrap, thread, access }, identity: "learner" };
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

/**
 * A visitor's journey: their token (a new visit if none), then the public
 * bootstrap (course preview, conversation, allowance). A refused token is
 * dropped and the visit started again, once. No thread is opened here: it
 * is created with the first message, so a look around costs nothing.
 */
const visitorBoot = async (trackId: string, visitor: VisitorBootDeps): Promise<BootOutcome> => {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let token: string;
    try {
      token = await visitor.ensureToken();
    } catch (error) {
      // Too many visits from this address: signing in still works.
      return statusOf(error) === 429 ? { kind: "signed_out" } : { kind: "error" };
    }
    let wire: GuideBootstrapWire;
    try {
      wire = await visitor.getBootstrap(trackId, token);
    } catch (error) {
      const refused = statusOf(error) === 401 || errorCodeOf(error) === "GUIDE_VISITOR_INVALID";
      if (refused && attempt === 0) {
        visitor.dropToken();
        continue;
      }
      if (statusOf(error) === 404) return { kind: "unavailable" };
      return refusal(error) ?? { kind: "error" };
    }
    const bootstrap = fromBootstrapWire(trackId, wire);
    if (!bootstrap.availability.guided) return { kind: "disabled" };
    if (!bootstrap.availability.anonymousChat) return { kind: "signed_out" };
    return { kind: "ready", bootstrap, identity: "visitor", visitorToken: token };
  }
  return { kind: "error" };
};

/**
 * The visitor token goes along once with the signed-in thread call. The
 * server checks access first; a refusal leaves the visitor thread as it was,
 * so the token is kept. A token it doesn't know is simply `none`.
 */
const claimVisit = async (
  trackId: string,
  deps: BootDeps,
): Promise<{ claim?: ClaimOutcome; outcome?: BootOutcome }> => {
  const token = deps.claim?.pendingToken();
  if (!token || !deps.claim) return {};
  try {
    const opened = await deps.claim.claimThread(trackId, token);
    deps.claim.dropToken();
    return { claim: opened.claim ?? "none" };
  } catch (error) {
    if (errorCodeOf(error) === "GUIDE_VISITOR_INVALID") {
      deps.claim.dropToken();
      return {};
    }
    const refused = refusal(error);
    if (refused?.kind === "denied") {
      const denied = await deniedWithReason(trackId, deps);
      return { outcome: { ...denied, claimRefused: true } as BootOutcome };
    }
    return { outcome: refused ?? { kind: "error" } };
  }
};

export const bootJourney = async (trackId: string, deps: BootDeps): Promise<BootOutcome> => {
  if (!trackId) return { kind: "unavailable" };
  if (!deps.isSignedIn()) {
    let availability: Partial<JourneyAvailability>;
    try {
      availability = await deps.getAvailability(trackId);
    } catch {
      return { kind: "disabled" };
    }
    if (availability.guided !== true) return { kind: "disabled" };
    // Anonymous chat off, or this build has no visitor support: sign in first.
    if (availability.anonymousChat !== true || !deps.visitor) return { kind: "signed_out" };
    return visitorBoot(trackId, deps.visitor);
  }

  const claimed = await claimVisit(trackId, deps);
  if (claimed.outcome) return claimed.outcome;
  const outcome = await learnerBoot(trackId, deps);
  return outcome.kind === "ready" && claimed.claim ? { ...outcome, claim: claimed.claim } : outcome;
};

const learnerBoot = async (trackId: string, deps: BootDeps): Promise<BootOutcome> => {
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
