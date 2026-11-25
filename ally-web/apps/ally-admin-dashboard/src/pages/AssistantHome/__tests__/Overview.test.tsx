import React from "react";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import { Permissions } from "@constants";

/**
 * The Overview (stage 7): how it's doing, from `GET :id/home/overview` (counts only, small groups
 * already held back by the server), the 30-day nudge, and "See all numbers" for staff only.
 */
const h = vi.hoisted(() => ({
  overview: vi.fn(),
  readAgain: vi.fn(),
  setStatus: vi.fn(),
  permissions: { current: [] as string[] },
  access: { current: [{ id: "e1" }] as unknown[] | undefined },
}));

vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGetTemplateCatalogueQuery: () => ({ data: undefined, isLoading: false, isError: false }),
  useGetTemplateOriginQuery: () => ({ data: undefined }),
  useApplyDraftTemplateMutation: () => [vi.fn()],
  useGetAssistantTemplatesQuery: () => ({ data: undefined, isLoading: false, isError: false }),
  useInstallTemplateMutation: () => [vi.fn(), { isLoading: false }],
  useArchiveChatbotMutation: () => [vi.fn(), { isLoading: false }],
  useSetChatbotStatusMutation: () => [
    (args: unknown) => ({ unwrap: () => h.setStatus(args) }),
    { isLoading: false },
  ],
  useGetAccessListQuery: () => ({ data: h.access.current }),
  useGetHomeOverviewQuery: (arg: unknown) => h.overview(arg),
  useReadSourceAgainMutation: () => [
    (args: unknown) => ({ unwrap: () => Promise.resolve(h.readAgain(args)) }),
    { isLoading: false },
  ],
}));
vi.mock("@hooks", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useUser: () => ({ permissions: h.permissions.current }),
}));
vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn() }));
vi.mock("../sections/Scorecard", () => ({ Scorecard: () => null }));
vi.mock("../../Onboarding/Screens", () => ({ Qr: () => null }));
vi.mock("../../Analytics/chartKit", () => ({
  Sparkline: ({ values, label }: { values: number[]; label?: string }) => (
    <svg data-testid="spark" data-values={values.join(",")} aria-label={label} />
  ),
}));
vi.mock("../sections/AllNumbers", () => ({
  AllNumbers: () => <div data-testid="all-numbers" />,
}));

const { OverviewSection } = await import("../sections/Overview");
const { HOME } = await import("../copy");
const { TF1_COPY } = await import("../copy/tf1");
const { OVERVIEW_COPY: o, LIVE_ACCESS_COPY: la } = await import("../copy/overview");
const t = HOME.overview;

const BOT = { id: "bot-1", status: "live" };
const LESS = { lessThan: 5 };

const DATA = {
  range: 30,
  timeZone: "Asia/Kolkata",
  from: "2026-10-25",
  to: "2026-11-23",
  conversations: 120,
  people: 80,
  days: [
    { day: "2026-11-21", conversations: 30, people: 20 },
    { day: "2026-11-22", conversations: LESS, people: LESS },
    { day: "2026-11-23", conversations: 12, people: 9 },
  ],
  answered: { share: 82, fewerThan5: false },
  handedToPerson: { count: LESS, medianWaitMinutes: null },
  ratings: { up: 14, down: LESS },
  byChannel: [],
  byLanguage: [],
  topUnanswered: [
    { kind: "question", text: "Do you open on Sunday?", count: 7 },
    { kind: "theme", theme: "no_hits", count: LESS },
  ],
};

const view = (home: Record<string, unknown> = {}, props: Record<string, unknown> = {}) =>
  render(
    <OverviewSection
      {...({
        bot: BOT,
        home: { ...home },
        canEdit: true,
        canManage: false,
        go: vi.fn(),
        ...props,
      } as never)}
    />,
  );

beforeEach(() => {
  h.overview.mockReset().mockReturnValue({ data: DATA, isError: false, refetch: vi.fn() });
  h.readAgain.mockReset().mockReturnValue({ changed: false });
  h.setStatus.mockReset().mockResolvedValue({});
  h.permissions.current = [];
  h.access.current = [{ id: "e1" }];
});

describe("the live line", () => {
  it("says it is live for the people on the Who may chat list, never for everyone", () => {
    view();
    const status = screen.getByTestId("overview-status").textContent ?? "";
    expect(status).toContain(la.live);
    expect(status).not.toContain("WhatsApp");
  });

  it("says nobody can chat yet when the list is empty, with a link to Channels", () => {
    h.access.current = [];
    const go = vi.fn();
    view({}, { go });
    expect(screen.getByTestId("overview-status").textContent).toContain(la.nobody);
    fireEvent.click(screen.getByRole("button", { name: la.link }));
    expect(go).toHaveBeenCalledWith("channels");
  });
});

describe("how it's doing", () => {
  it("shows plain totals and 'Fewer than 5' exactly as the server sent them", () => {
    view();
    expect(screen.getByTestId("ov-conversations").textContent).toContain("120");
    expect(screen.getByTestId("ov-people").textContent).toContain("80");
    expect(screen.getByTestId("ov-answered").textContent).toContain("82%");
    // Handed to a person: under 5 and no wait time to quote.
    const handed = screen.getByTestId("ov-handed").textContent ?? "";
    expect(handed).toContain(o.lessThan);
    expect(handed).toContain(o.handedWaitNone);
    expect(screen.getByTestId("ov-ratings").textContent).toContain("14 thumbs up");
    expect(screen.getByTestId("ov-ratings").textContent).toContain(`${o.lessThan} thumbs down`);
  });

  it("draws a day under 5 at the bottom and says so", () => {
    view();
    const [conversations] = screen.getAllByTestId("spark");
    expect(conversations.getAttribute("data-values")).toBe("30,0,12");
    expect(screen.getByText(o.lowDaysNote)).toBeTruthy();
  });

  it("quotes a question only when the server sent it, and shows small groups as a topic", () => {
    view();
    const list = screen.getByTestId("ov-unanswered").textContent ?? "";
    expect(list).toContain("Do you open on Sunday?");
    expect(list).toContain(`${o.themes.no_hits}: ${o.lessThan}`);
    expect(list).toContain(o.themeNote);
  });

  it("is stacked cards, laid out by the phone-first class (no fixed widths in the markup)", () => {
    view();
    const cards = screen.getByTestId("overview-cards");
    expect(cards.className).toContain("ally-overview__cards");
    expect(cards.querySelectorAll(".ally-overview__card").length).toBe(4);
    expect(cards.querySelector("[style*='width']")).toBeNull();
  });

  it("asks for the range chosen", () => {
    view();
    expect(h.overview).toHaveBeenLastCalledWith({ id: "bot-1", range: 30 });
    fireEvent.click(screen.getByRole("radio", { name: o.last90 }));
    expect(h.overview).toHaveBeenLastCalledWith({ id: "bot-1", range: 90 });
    fireEvent.click(screen.getByRole("radio", { name: o.last7 }));
    expect(h.overview).toHaveBeenLastCalledWith({ id: "bot-1", range: 7 });
  });

  it("says nobody has chatted yet instead of a wall of zeros", () => {
    h.overview.mockReturnValue({
      data: { ...DATA, conversations: 0, people: 0, days: [] },
      isError: false,
    });
    view();
    expect(screen.getByText(o.empty)).toBeTruthy();
    expect(screen.queryByTestId("overview-cards")).toBeNull();
  });

  it("offers a retry when the numbers fail to load", () => {
    const refetch = vi.fn();
    h.overview.mockReturnValue({ data: undefined, isError: true, refetch });
    view();
    fireEvent.click(screen.getByRole("button", { name: o.retry }));
    expect(refetch).toHaveBeenCalled();
  });
});

describe("the 30-day nudge", () => {
  const stale = {
    knowledgeStaleNudge: true,
    knowledgeStaleDays: 41,
    knowledgeStaleDocumentId: "doc-1",
  };

  it("says when it was last read and reads again on a click", async () => {
    view(stale);
    expect(screen.getByTestId("overview-stale").textContent).toContain("Last read 41 days ago");
    fireEvent.click(screen.getByRole("button", { name: o.readAgain }));
    await waitFor(() =>
      expect(h.readAgain).toHaveBeenCalledWith({ id: "bot-1", documentId: "doc-1" }),
    );
    await screen.findByText(o.readDone);
  });

  it("is not shown when sources are fresh, or to someone who can't edit", () => {
    view({ knowledgeStaleNudge: false, knowledgeStaleDays: 3 });
    expect(screen.queryByTestId("overview-stale")).toBeNull();
  });

  it("is hidden from a viewer", () => {
    view(stale, { canEdit: false });
    expect(screen.queryByTestId("overview-stale")).toBeNull();
  });
});

describe("See all numbers", () => {
  it("is for staff only, and opens in place", () => {
    view();
    expect(screen.queryByRole("button", { name: t.seeAllNumbers })).toBeNull();
    expect(screen.queryByTestId("all-numbers")).toBeNull();
  });

  it("opens for staff, and an old usage link arrives with it open", () => {
    h.permissions.current = [Permissions.SYSTEM_ACCESS];
    const { unmount } = view();
    expect(screen.queryByTestId("all-numbers")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: t.seeAllNumbers }));
    expect(screen.getByTestId("all-numbers")).toBeTruthy();
    unmount();
    view({}, { openAllNumbers: true });
    expect(screen.getByTestId("all-numbers")).toBeTruthy();
  });

  it("an old usage link does not open it for a builder", () => {
    view({}, { openAllNumbers: true });
    expect(screen.queryByTestId("all-numbers")).toBeNull();
  });
});

// TF1 S1: "Turn on" on a never-published assistant got a silent 409.
describe("the one switch", () => {
  it("sends a never-published assistant to Build, where the checklist and Go live are", () => {
    const go = vi.fn();
    view({}, { bot: { id: "bot-1", status: "draft" }, go });
    fireEvent.click(screen.getByRole("button", { name: TF1_COPY.overview.finishToGoLive }));
    expect(go).toHaveBeenCalledWith("build", "personality");
    expect(h.setStatus).not.toHaveBeenCalled();
  });

  it("says why turning a paused assistant on was refused", async () => {
    h.setStatus.mockReturnValue(
      Promise.reject({ status: 409, data: { message: "Finish the checklist first." } }),
    );
    view({}, { bot: { id: "bot-1", status: "paused" } });
    fireEvent.click(screen.getByRole("button", { name: t.turnOn }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("Finish the checklist first."),
    );
    expect(h.setStatus).toHaveBeenCalledWith({ id: "bot-1", status: "live" });
  });
});
