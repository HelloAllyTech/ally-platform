import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

const h = vi.hoisted(() => ({ list: vi.fn(), unread: vi.fn(), read: vi.fn(), readAll: vi.fn() }));

vi.mock(
  "@ally-ui-mono/ui-shared",
  async () => (await import("../../ally-guide/__tests__/uiSharedFakes")).uiSharedFakes,
);
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGetNotificationsQuery: () => h.list(),
  useGetUnreadNotificationCountQuery: () => h.unread(),
  useMarkNotificationReadMutation: () => [h.read],
  useMarkAllNotificationsReadMutation: () => [h.readAll, { isLoading: false }],
}));

/* eslint-disable import/first */
import { NotificationBell, notificationHref } from "../NotificationBell";
/* eslint-enable import/first */

const N = (over: Record<string, unknown> = {}) => ({
  id: "n1",
  type: "DEBRIEF_TEAM_ALERT",
  title: "Urgent item overdue",
  body: "A flag on an important moment has waited past the deadline.",
  data: { screen: "DebriefConsole", runId: "run-7" },
  readAt: null,
  createdAt: "2026-11-12T10:00:00Z",
  ...over,
});

const Where = () => {
  const l = useLocation();
  return <div data-testid="where">{`${l.pathname}${l.search}`}</div>;
};

beforeEach(() => {
  vi.clearAllMocks();
  h.unread.mockReturnValue({ data: { count: 2 } });
  h.list.mockReturnValue({
    data: {
      count: 2,
      data: [N(), N({ id: "n2", readAt: "x", data: { screen: "DebriefConsole", ideaId: "i9" } })],
    },
    isLoading: false,
    isError: false,
  });
  h.read.mockReturnValue(Promise.resolve());
  h.readAll.mockReturnValue(Promise.resolve());
});

describe("NotificationBell", () => {
  it("shows the unread count, lists the feed and opens the item, marking it read", async () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<NotificationBell />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByTestId("notification-unread")).toHaveTextContent("2");
    fireEvent.click(screen.getByRole("button", { name: "Notifications, 2 unread" }));
    const items = screen.getAllByTestId("notification-item");
    expect(items).toHaveLength(2);
    fireEvent.click(items[0]);
    expect(h.read).toHaveBeenCalledWith("n1");
    await waitFor(() =>
      expect(screen.getByTestId("where")).toHaveTextContent("/debriefs/sessions/run-7"),
    );
  });

  it("marks everything read", () => {
    render(
      <MemoryRouter>
        <NotificationBell />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Notifications, 2 unread" }));
    fireEvent.click(screen.getByRole("button", { name: "Mark all read" }));
    expect(h.readAll).toHaveBeenCalled();
  });

  it("links debrief alerts to the session, the idea or the release", () => {
    expect(notificationHref(N() as never)).toBe("/debriefs/sessions/run-7");
    expect(notificationHref(N({ data: { screen: "DebriefConsole", ideaId: "i9" } }) as never)).toBe(
      "/debriefs/pm-agent?idea=i9",
    );
    expect(
      notificationHref(N({ data: { screen: "DebriefConsole", releaseId: "r3" } }) as never),
    ).toBe("/debriefs/pm-agent?view=releases&releaseId=r3");
    expect(notificationHref(N({ data: { screen: "Simulations" } }) as never)).toBeNull();
  });
});
