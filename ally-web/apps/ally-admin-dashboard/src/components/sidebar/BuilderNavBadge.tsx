import { FC } from "react";

import { useGetBuilderDecisionsQuery } from "@api";
import { en } from "@constants";

/**
 * How many decisions are waiting on you, on Builder's sidebar tab — the same
 * number as the Builder tab's summary and the browser tab's title, so the
 * three never disagree. A backgrounded agent waiting on a question should be
 * visible from anywhere in the console.
 *
 * Polled slowly (a minute) because it is on every page; the Builder tab
 * refreshes the same cache much faster while it is open, and answering a
 * decision invalidates it.
 */
export const BuilderNavBadge: FC = () => {
  const { data } = useGetBuilderDecisionsQuery(undefined, {
    pollingInterval: 60_000,
    skipPollingIfUnfocused: true,
  });

  const unread = data?.count ?? 0;

  if (unread === 0) return null;

  return (
    <span
      className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary-600 px-1.5 text-xs font-semibold text-white"
      title={en.builder.decisions.waiting(unread)}
    >
      {unread}
    </span>
  );
};
