import React from "react";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

import { ChangeLogPanel } from "../ChangeLogPanel";

const feed = vi.hoisted(() => ({
  state: {
    data: undefined as unknown,
    isLoading: false,
    isError: false,
    isFetching: false,
  },
  refetch: vi.fn(),
  calls: [] as unknown[],
}));
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<typeof import("@api")>()),
  useGetPublicProductUpdatesQuery: (params: unknown) => {
    feed.calls.push(params);
    return { ...feed.state, refetch: feed.refetch };
  },
}));

const update = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  slug: id,
  title: `Update ${id}`,
  summary: `Summary of ${id}`,
  kind: "new",
  surfaces: ["whatsapp"],
  area: "WhatsApp assistant",
  liveAt: "2025-11-20T09:00:00.000Z",
  ...over,
});

describe("ChangeLogPanel", () => {
  beforeEach(() => {
    feed.calls = [];
    feed.refetch.mockClear();
    feed.state = { data: undefined, isLoading: false, isError: false, isFetching: false };
  });
  afterEach(cleanup);

  it("asks the public feed for Ally Chatbots updates only, ten at a time", () => {
    feed.state.data = { updates: [], count: 0 };
    render(<ChangeLogPanel />);
    expect(feed.calls[0]).toEqual({ area: "WhatsApp assistant", limit: 10 });
  });

  it("lists the updates newest first under month headings, with kind and date", () => {
    feed.state.data = {
      updates: [
        update("a", { kind: "fixed", liveAt: "2025-11-20T09:00:00.000Z" }),
        update("b", { kind: "improved", liveAt: "2025-11-02T09:00:00.000Z" }),
        update("c", { kind: "new", liveAt: "2025-10-28T09:00:00.000Z" }),
      ],
      count: 3,
    };
    render(<ChangeLogPanel />);
    expect(
      screen.getAllByTestId("changelog-entry").map(li => li.querySelector("strong")?.textContent),
    ).toEqual(["Update a", "Update b", "Update c"]);
    expect(screen.getByRole("region", { name: "November 2025" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "October 2025" })).toBeInTheDocument();
    const first = screen.getAllByTestId("changelog-entry")[0];
    expect(first).toHaveTextContent("Fixed");
    expect(first).toHaveTextContent("20 Nov 2025");
    expect(first).toHaveTextContent("Summary of a");
    expect(screen.queryByTestId("changelog-more")).toBeNull();
  });

  it("shows more when there are more, a page at a time", () => {
    feed.state.data = { updates: [update("a")], count: 25 };
    render(<ChangeLogPanel />);
    expect(screen.getByText("Showing 1 of 25")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("changelog-more"));
    expect(feed.calls[feed.calls.length - 1]).toEqual({ area: "WhatsApp assistant", limit: 20 });
  });

  it("says so when there is nothing yet, and when it could not load", () => {
    feed.state.data = { updates: [], count: 0 };
    render(<ChangeLogPanel />);
    expect(screen.getByTestId("changelog-empty")).toHaveTextContent("No updates yet");
    cleanup();
    feed.state = { data: undefined, isLoading: false, isError: true, isFetching: false };
    render(<ChangeLogPanel />);
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load the change log.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(feed.refetch).toHaveBeenCalled();
  });
});
