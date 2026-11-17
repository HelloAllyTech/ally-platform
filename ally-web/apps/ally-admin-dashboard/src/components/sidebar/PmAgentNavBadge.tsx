import { FC } from "react";

import { useGetPmAgentFeedStateQuery } from "@api";

/**
 * Open cards plus items that need you, on the PM Agent tab. Polled slowly because it is on every
 * page; the tab itself polls the same cache faster while open. Mounted only for holders of the
 * `pm_agent` toggle, so nobody else issues the request.
 */
export const PmAgentNavBadge: FC = () => {
  const { data } = useGetPmAgentFeedStateQuery(undefined, {
    pollingInterval: 60_000,
    skipPollingIfUnfocused: true,
  });
  const count = (data?.queue.open ?? 0) + (data?.queue.needsYou ?? 0);
  if (count === 0) return null;
  const needs = data?.queue.needsYou ?? 0;
  return (
    <span
      className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary-600 px-1.5 text-xs font-semibold text-white"
      title={`${data?.queue.open ?? 0} to review${needs > 0 ? `, ${needs} need you` : ""}`}
      aria-label={`${count} waiting in PM Agent`}
    >
      {count}
    </span>
  );
};
