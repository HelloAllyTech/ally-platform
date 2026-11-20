/** The server's message from a failed request, or `fallback` when it sent none. */
export const errorMessage = (error: unknown, fallback: string): string => {
  const data = (error as { data?: { message?: unknown } } | undefined)?.data;
  const message = data?.message;
  if (typeof message === "string" && message) return message;
  if (Array.isArray(message) && typeof message[0] === "string") return message.join(", ");
  return fallback;
};

/**
 * The plain-language list the server returns when a page is not ready to
 * publish (`{ message, problems: [...] }`), or an empty list for any other error.
 */
export const publishProblems = (error: unknown): string[] => {
  const problems = (error as { data?: { problems?: unknown } } | undefined)?.data?.problems;
  return Array.isArray(problems)
    ? problems.filter((item): item is string => typeof item === "string")
    : [];
};
