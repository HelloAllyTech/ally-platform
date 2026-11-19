/**
 * The plan's refusals (CR1 enforcement). ally-be refuses an owner-side run before any AI call with
 * 403 and one of these codes, and its message is the words to show: "Your tokens are used up. Ask
 * Ally to add more." Screens show that message instead of their generic "something went wrong".
 */
export const PLAN_LIMIT_CODES = [
  "TOKENS_USED_UP",
  "PLAN_OWNER_RUNS_USED_UP",
  "PLAN_PUBLISH_LIMIT",
] as const;

interface ErrorBody {
  errorCode?: unknown;
  message?: unknown;
}

/** The server's message when `error` (an RTK Query error, or a parsed body) is a plan limit. */
export const planLimitMessage = (error: unknown): string | null => {
  const body: ErrorBody | undefined =
    (error as { data?: ErrorBody })?.data ?? (error as ErrorBody | undefined);
  if (!body || typeof body !== "object") return null;
  const code = body.errorCode;
  if (typeof code !== "string" || !(PLAN_LIMIT_CODES as readonly string[]).includes(code)) {
    return null;
  }
  return typeof body.message === "string" && body.message ? body.message : null;
};
