import { COPY } from "./copy";

export const errorText = (error: unknown): string => {
  const data = (error as { data?: { message?: unknown } })?.data;
  return typeof data?.message === "string" ? data.message : COPY.problems.generic;
};
