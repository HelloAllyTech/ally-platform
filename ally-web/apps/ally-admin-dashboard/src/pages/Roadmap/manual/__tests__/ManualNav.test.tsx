import "@constants";
import React from "react";

import { configureStore } from "@reduxjs/toolkit";
import { render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { FeatureToggleKey, ROUTES, en } from "@constants";
import { resolveRouteMeta } from "@routes/routeMeta";

vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGetRoadmapPreferencesQuery: () => ({ data: undefined }),
  useSetRoadmapPreferencesMutation: () => [vi.fn(), { isLoading: false }],
}));

import { MoreSheetContent } from "../../components/RoadmapAreaNav";
import { RoadmapTopNav } from "../../components/RoadmapTopNav";

const withStore = (features: string[], node: React.ReactNode, path = "/roadmap") => {
  const store = configureStore({
    reducer: { user: () => ({ features, permissions: [] as string[] }) },
  });
  return render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>
    </Provider>,
  );
};

describe("Product Manual tab", () => {
  it("is hidden without the product_manual toggle", () => {
    withStore([], <RoadmapTopNav phone={false} />);
    expect(screen.queryByRole("link", { name: en.productManual.tab })).toBeNull();
  });

  it("shows with the toggle and is current on a manual page", () => {
    withStore(
      [FeatureToggleKey.PRODUCT_MANUAL],
      <RoadmapTopNav phone={false} />,
      "/roadmap/manual/scores",
    );
    const tab = screen.getByRole("link", { name: en.productManual.tab });
    expect(tab).toHaveAttribute("href", ROUTES.ROADMAP_MANUAL);
    expect(tab).toHaveAttribute("aria-current", "page");
  });

  it("is in the phone's More sheet only with the toggle", () => {
    const { unmount } = withStore([], <MoreSheetContent role="idea" onNavigate={vi.fn()} />);
    expect(screen.queryByRole("link", { name: en.productManual.tab })).toBeNull();
    unmount();
    withStore(
      [FeatureToggleKey.PRODUCT_MANUAL],
      <MoreSheetContent role="idea" onNavigate={vi.fn()} />,
    );
    expect(screen.getByRole("link", { name: en.productManual.tab })).toBeInTheDocument();
  });

  it("has a title and hangs off the Roadmap in the route table", () => {
    expect(FeatureToggleKey.PRODUCT_MANUAL).toBe("product_manual");
    expect(ROUTES.ROADMAP_MANUAL_PAGE("scores")).toBe("/roadmap/manual/scores");
    const meta = resolveRouteMeta("/roadmap/manual/scores");
    expect(meta.title).toBe(en.productManual.title);
    expect(meta.fullBleed).toBe(true);
  });
});
