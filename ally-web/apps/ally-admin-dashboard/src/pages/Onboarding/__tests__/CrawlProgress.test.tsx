import React from "react";

import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useTestBotDraftMutation: () => [vi.fn()],
}));
vi.mock("@hooks/useChatbotTestStream", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useChatbotTestStream: () => ({ run: vi.fn(), cancel: vi.fn() }),
}));

// eslint-disable-next-line import/first
import { DraftTestPane, CRAWL_MAX_PAGES } from "../DraftTestPane";

const view = (status: string, pagesRead: number) =>
  ({
    id: "d1",
    status: "active",
    version: 1,
    chatbotId: "b1",
    draft: {},
    crawl: { status, pagesRead },
  }) as never;

const line = () => screen.getByTestId("draft-crawl-progress");
const pane = (v: never) => <DraftTestPane draftId="d1" view={v} />;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("crawl progress line", () => {
  it("names the cap the backend uses", () => {
    expect(CRAWL_MAX_PAGES).toBe(50);
  });

  it("shows n of up to max while running, politely", () => {
    render(pane(view("running", 4)));
    expect(line().textContent).toBe("Learned 4 of up to 50 pages");
    expect(line().getAttribute("aria-live")).toBe("polite");
  });

  it("holds back fast updates and shows the latest after 3 seconds", () => {
    const { rerender } = render(pane(view("running", 4)));
    rerender(pane(view("running", 9)));
    rerender(pane(view("running", 12)));
    expect(line().textContent).toBe("Learned 4 of up to 50 pages");
    act(() => {
      vi.advanceTimersByTime(3100);
    });
    expect(line().textContent).toBe("Learned 12 of up to 50 pages");
  });

  it("changes to the quiet done line at once on completion", () => {
    const { rerender } = render(pane(view("running", 4)));
    rerender(pane(view("done", 31)));
    expect(line().textContent).toBe("Learned 31 pages");
  });

  it("shows nothing when there is no read", () => {
    render(pane(view("idle", 0)));
    expect(line().textContent).toBe("");
  });
});
