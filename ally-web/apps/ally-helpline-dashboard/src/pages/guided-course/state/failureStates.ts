/**
 * Every way a turn or the session can fail, mapped to a designed state in
 * Ally's voice (plan §5.12; voice and tone §10). Never a red toast and never
 * an error code: each state says what happened and offers a way forward
 * (Stacks: "Apologetic Language and Resolution Paths in Agent Failures").
 * Ally apologises only when the failure is Ally's.
 */
import type { GuideFailureCode } from "../contract/wire";

export type FailureAction =
  /** Send the learner's message again. */
  | "retry"
  /** Leave for the classic course at the current item. */
  | "classic"
  | "signIn"
  | "myCourses"
  /** Nothing to press; it clears on its own (rate limit, cooldown, other tab). */
  | null;

export interface FailureState {
  /** i18n key of the line Ally says. */
  copyKey: string;
  action: FailureAction;
  /** Ends the guided session (move to classic, or the access card). */
  terminal?: "classic" | "denied";
}

export const FAILURE_STATES: Record<GuideFailureCode, FailureState> = {
  turn_in_progress: { copyKey: "guide.failure.anotherTab", action: null },
  guide_disabled: { copyKey: "guide.failure.disabled", action: "classic", terminal: "classic" },
  allowance_exhausted: { copyKey: "guide.failure.allowanceUsed", action: "signIn" },
  anonymous_paused: { copyKey: "guide.failure.anonymousPaused", action: "signIn" },
  not_enrolled: { copyKey: "guide.failure.notEnrolled", action: "retry" },
  no_access: { copyKey: "guide.failure.noAccess", action: "myCourses", terminal: "denied" },
  rate_limited: { copyKey: "guide.failure.rateLimited", action: null },
  cooldown: { copyKey: "guide.failure.cooldown", action: null },
  provider_unavailable: { copyKey: "guide.failure.providerOutage", action: "classic" },
  message_too_long: { copyKey: "guide.failure.tooLong", action: null },
  interrupted: { copyKey: "guide.failure.turnFailed", action: "retry" },
  internal_error: { copyKey: "guide.failure.turnFailed", action: "retry" },
};

export const failureStateFor = (code: GuideFailureCode | string): FailureState =>
  FAILURE_STATES[code as GuideFailureCode] ?? FAILURE_STATES.internal_error;

/**
 * HTTP refusals on the guide's REST routes carry the platform `errorCode`
 * (upper case; build log, departure 6). Map them onto the stream's codes so
 * one table drives the UI.
 */
export const failureCodeFromHttp = (
  status: number | string | undefined,
  errorCode: string | undefined,
): GuideFailureCode => {
  switch (errorCode) {
    case "GUIDE_DISABLED":
      return "guide_disabled";
    case "GUIDE_NO_ACCESS":
      return "no_access";
    case "GUIDE_MESSAGE_TOO_LONG":
      return "message_too_long";
    default:
      break;
  }
  if (status === 429) return "rate_limited";
  if (status === 503 || status === 502) return "provider_unavailable";
  return "internal_error";
};

/** Reads `errorCode` from an RTK Query error or a parsed fetch body. */
export const errorCodeOf = (error: unknown): string | undefined => {
  const data = (error as { data?: unknown } | undefined)?.data;
  if (data && typeof data === "object" && "errorCode" in data) {
    const code = (data as { errorCode?: unknown }).errorCode;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
};

export const statusOf = (error: unknown): number | string | undefined =>
  (error as { status?: number | string } | undefined)?.status;
