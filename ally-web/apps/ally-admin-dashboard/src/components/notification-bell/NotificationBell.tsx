import { FC, useEffect, useRef, useState } from "react";

import { Notification } from "@icons";
import { useNavigate } from "react-router-dom";

import { Button } from "@ally-ui-mono/ui-shared";
import {
  useGetNotificationsQuery,
  useGetUnreadNotificationCountQuery,
  useMarkAllNotificationsReadMutation,
  useMarkNotificationReadMutation,
} from "@api";
import { en, ROUTES } from "@constants";
import { AppNotification } from "@types";
import { formatDateTime } from "@utils";

/**
 * Where a notification opens. The Debriefs console's alerts carry `screen: "DebriefConsole"` and
 * the session, idea or release they are about; anything else has nowhere to go here.
 */
export const notificationHref = (n: AppNotification): string | null => {
  const d = n.data ?? {};
  if (d.screen !== "DebriefConsole") return null;
  if (typeof d.runId === "string") return ROUTES.DEBRIEF_SESSION(d.runId);
  if (typeof d.ideaId === "string") return `${ROUTES.DEBRIEFS_PM_AGENT}?idea=${d.ideaId}`;
  if (typeof d.releaseId === "string") {
    return `${ROUTES.DEBRIEFS_PM_AGENT}?view=releases&releaseId=${d.releaseId}`;
  }
  return ROUTES.DEBRIEFS;
};

/**
 * The admin's notification bell: the caller's in-app feed (`/v1/notifications`), an unread count,
 * a list linking to each item, and mark read. ally-be sends each person only what their role
 * receives. Modelled on Builder's bell; `placement` opens the list above (the sidebar's foot) or
 * below (the phone's top bar).
 */
export const NotificationBell: FC<{ placement?: "above" | "below" }> = ({
  placement = "above",
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const strings = en.notificationsBell;

  const unreadQ = useGetUnreadNotificationCountQuery(undefined, {
    pollingInterval: 60_000,
    skipPollingIfUnfocused: true,
  });
  const listQ = useGetNotificationsQuery({ limit: 25 }, { skip: !isOpen });
  const [markRead] = useMarkNotificationReadMutation();
  const [markAllRead, { isLoading: isClearing }] = useMarkAllNotificationsReadMutation();
  const unread = unreadQ.data?.count ?? 0;
  const items = listQ.data?.data ?? [];

  useEffect(() => {
    if (!isOpen) return undefined;
    const onClickAway = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", onClickAway);
    return () => document.removeEventListener("mousedown", onClickAway);
  }, [isOpen]);

  const open = (n: AppNotification) => {
    if (!n.readAt) void markRead(n.id);
    const href = notificationHref(n);
    setIsOpen(false);
    if (href) navigate(href);
  };

  return (
    <div ref={containerRef} className="relative" data-testid="notification-bell">
      <button
        type="button"
        aria-label={unread ? strings.titleUnread(unread) : strings.title}
        aria-expanded={isOpen}
        onClick={() => setIsOpen(o => !o)}
        className="relative flex cursor-pointer items-center justify-center rounded p-1.5 text-typography-700 hover:bg-neutral-100"
      >
        <Notification className="h-5 w-5" />
        {unread > 0 && (
          <span
            data-testid="notification-unread"
            className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary-600 px-1 text-xs font-semibold text-white"
          >
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      {isOpen && (
        <div
          role="dialog"
          aria-label={strings.title}
          className={[
            "absolute z-50 w-80 rounded-sm border border-border-light bg-white shadow-md",
            placement === "above" ? "bottom-full left-0 mb-1" : "right-0 top-full mt-1",
            "max-md:fixed max-md:inset-x-4 max-md:top-16 max-md:bottom-auto max-md:mb-0 max-md:mt-0 max-md:w-auto",
          ].join(" ")}
        >
          <div className="flex items-center justify-between gap-2 border-b border-border-light px-4 py-3">
            <span className="text-sm font-semibold text-typography-900">{strings.title}</span>
            {unread > 0 && (
              <Button
                size="sm"
                kind="ghost"
                disabled={isClearing}
                onClick={() => void markAllRead()}
              >
                {strings.markAllRead}
              </Button>
            )}
          </div>
          <ul className="custom-scrollbar max-h-80 overflow-y-auto">
            {listQ.isError ? (
              <li className="px-4 py-6 text-sm text-destructive-500">{strings.error}</li>
            ) : listQ.isLoading ? (
              <li className="px-4 py-6 text-sm text-typography-500">{strings.loading}</li>
            ) : items.length === 0 ? (
              <li className="px-4 py-6 text-sm text-typography-500">{strings.empty}</li>
            ) : (
              items.map(n => (
                <li key={n.id}>
                  <button
                    type="button"
                    data-testid="notification-item"
                    onClick={() => open(n)}
                    className={`w-full cursor-pointer border-b border-b-border-light px-4 py-3 text-left hover:bg-neutral-50 ${n.readAt ? "opacity-60" : ""}`}
                  >
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-semibold text-typography-900">{n.title}</span>
                      <span className="ml-auto whitespace-nowrap text-xs tabular-nums text-typography-500">
                        {formatDateTime(n.createdAt)}
                      </span>
                    </div>
                    <p className="mt-0.5 break-words text-sm text-typography-700">{n.body}</p>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
};
