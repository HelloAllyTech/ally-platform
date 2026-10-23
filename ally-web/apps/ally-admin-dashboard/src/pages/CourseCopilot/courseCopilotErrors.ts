/**
 * What actually went wrong, when the server bothered to say.
 *
 * Nest returns `message` as a string for its own exceptions and as an array of field errors from
 * class-validator. Both beat the generic fallback, which is kept for what has nothing to show — a
 * network drop, or a 500. The 409 on session creation ("you already have two active sessions") is
 * the one that matters most: the trainer can only act on it if they can read it.
 */
export const errorMessageFrom = (error: unknown, fallback: string): string => {
  const message = (error as { data?: { message?: unknown } })?.data?.message;
  if (Array.isArray(message) && message.length) return message.join(". ");
  if (typeof message === "string" && message.trim()) return message;
  return fallback;
};

/** The HTTP status of an RTK Query error, or undefined for a network failure. */
export const errorStatusOf = (error: unknown): number | undefined => {
  const status = (error as { status?: unknown })?.status;
  return typeof status === "number" ? status : undefined;
};
