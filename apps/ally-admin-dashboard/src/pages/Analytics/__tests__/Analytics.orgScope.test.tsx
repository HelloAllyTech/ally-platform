import { configureStore } from "@reduxjs/toolkit";
import { render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  if (typeof window !== "undefined") {
    window.requestAnimationFrame = (() => 0) as typeof window.requestAnimationFrame;
  }
});

// Every @api hook idle, except the org list the page names the picker from.
vi.mock("@api", () => {
  const idle = {
    data: undefined,
    isLoading: false,
    isFetching: false,
    isUninitialized: false,
    isError: false,
    refetch: vi.fn(),
  };
  const apiStub = (reducerPath: string) => ({
    reducerPath,
    reducer: (state: unknown = {}) => state,
    middleware: () => (next: (a: unknown) => unknown) => (action: unknown) => next(action),
  });
  const explicit: Record<string, unknown> = {
    baseAPI: apiStub("baseAPI"),
    evaluatorAPI: apiStub("evaluatorAPI"),
    useGetTenantsQuery: () => ({
      ...idle,
      data: {
        data: [
          { id: "org-b", name: "Beta Org" },
          { id: "org-a", name: "Alpha Org" },
        ],
      },
    }),
  };
  return new Proxy(explicit, {
    has: () => true,
    get: (target, name) => {
      if (typeof name !== "string" || name === "then" || name === "__esModule") return undefined;
      if (Object.prototype.hasOwnProperty.call(target, name)) return target[name];
      return name.endsWith("Mutation") ? () => [vi.fn(), idle] : () => idle;
    },
  });
});

// The tabs themselves have their own tests; here they only report what the
// page handed them.
vi.mock("../tabs/HighlightsTab", () => ({
  HighlightsTab: ({ query }: { query: { tenantId?: string } }) => (
    <div>highlights for {query.tenantId ?? "every org"}</div>
  ),
}));
vi.mock("../tabs/ScribeTab", () => ({ ScribeTab: () => <div>scribe</div> }));

import { Analytics } from "../Analytics";

const renderFor = (restrictedTenantIds: string[] | null) =>
  render(
    <Provider
      store={configureStore({
        reducer: (
          state = {
            user: { user: { id: 1, restrictedTenantIds }, features: ["analytics"] },
          },
        ) => state,
      })}
    >
      <MemoryRouter>
        <Analytics />
      </MemoryRouter>
    </Provider>,
  );

describe("Analytics for an organization-restricted admin", () => {
  it("shows only the org-scoped tabs, pinned to their first org by name", () => {
    renderFor(["org-b", "org-a"]);

    expect(screen.getAllByRole("tab").map(tab => tab.textContent)).toEqual([
      "Highlights",
      "Scribe",
    ]);
    expect(screen.getByText("highlights for org-a")).toBeInTheDocument();
    expect(screen.getByText(/Metrics for Alpha Org only/)).toBeInTheDocument();
    // Two orgs: a picker to switch between them.
    expect(screen.getByText("Organisation")).toBeInTheDocument();
  });

  it("offers no picker for a single org", () => {
    renderFor(["org-b"]);

    expect(screen.getByText("highlights for org-b")).toBeInTheDocument();
    expect(screen.queryByText("Organisation")).not.toBeInTheDocument();
  });

  it("says there is nothing to show when every org they held is gone", () => {
    renderFor([]);

    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(screen.getByText(/not assigned to any organisation/)).toBeInTheDocument();
  });

  it("leaves an unrestricted admin's page platform-wide", () => {
    renderFor(null);

    expect(screen.getAllByRole("tab").length).toBeGreaterThan(2);
    expect(screen.getByText("highlights for every org")).toBeInTheDocument();
    expect(screen.getByText(/Platform-wide metrics/)).toBeInTheDocument();
  });
});
