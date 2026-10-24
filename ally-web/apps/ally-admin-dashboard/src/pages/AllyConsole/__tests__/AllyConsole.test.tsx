import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work, and a mock registered after
// another import that pulls it in arrives too late.
import "@constants";

vi.mock(
  "@ally-ui-mono/ui-shared",
  async () =>
    (await import("../../../components/ally-guide/__tests__/uiSharedFakes")).uiSharedFakes,
);

const h = vi.hoisted(() => ({ access: { current: { canEdit: true } as Record<string, boolean> } }));
vi.mock("@hooks", () => ({ useAllyGuideAccess: () => h.access.current }));

// Each tab has its own suite; here they only need to say which one is showing.
vi.mock("../OverviewTab", () => ({
  OverviewTab: ({
    onOpenReleases,
    onOpenAlerts,
  }: {
    onOpenReleases: () => void;
    onOpenAlerts: () => void;
  }) => (
    <div data-testid="overview-tab">
      <button type="button" onClick={onOpenReleases}>
        open releases
      </button>
      <button type="button" onClick={onOpenAlerts}>
        open alerts
      </button>
    </div>
  ),
}));
vi.mock("../ConversationsTab", () => ({
  ConversationsTab: () => <div data-testid="conversations-tab" />,
}));
vi.mock("../ReleasesTab", () => ({
  ReleasesTab: ({ onOpenOverview }: { onOpenOverview: () => void }) => (
    <div data-testid="releases-tab">
      <button type="button" onClick={onOpenOverview}>
        open overview
      </button>
    </div>
  ),
}));
vi.mock("../PlaygroundTab", () => ({ PlaygroundTab: () => <div data-testid="playground-tab" /> }));
vi.mock("../AlertsTab", () => ({ AlertsTab: () => <div data-testid="alerts-tab" /> }));
vi.mock("../BaselineTab", () => ({ BaselineTab: () => <div data-testid="baseline-tab" /> }));
vi.mock("../SettingsTab", () => ({ SettingsTab: () => <div data-testid="settings-tab" /> }));
vi.mock("../CrisisCopyTab", () => ({ CrisisCopyTab: () => <div data-testid="crisis-copy-tab" /> }));

// eslint-disable-next-line import/first
import { AllyConsole } from "../AllyConsole";

const Where = () => <span data-testid="where">{useLocation().search}</span>;

const renderAt = (url = "/ally") =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <AllyConsole />
      <Where />
    </MemoryRouter>,
  );

describe("AllyConsole", () => {
  beforeEach(() => {
    h.access.current = { canEdit: true };
  });

  it("titles the page and says what it is for", () => {
    renderAt();

    expect(screen.getByRole("heading", { level: 1, name: "Ally Console" })).toBeInTheDocument();
    expect(screen.getByText(/control room for Ally/)).toBeInTheDocument();
  });

  it("offers the eight tabs, in order", () => {
    renderAt();

    expect(
      [
        "overview",
        "conversations",
        "releases",
        "playground",
        "alerts",
        "baseline",
        "settings",
        "crisis-copy",
      ].map(id => screen.getByTestId(`tab-${id}`).textContent),
    ).toEqual([
      "Overview",
      "Conversations",
      "Releases",
      "Playground",
      "Alerts",
      "Baseline",
      "Settings",
      "Crisis copy",
    ]);
  });

  it("hides the Playground tab from an admin who cannot edit, since the server would refuse every run", () => {
    h.access.current = { canEdit: false };
    renderAt();

    expect(screen.queryByTestId("tab-playground")).not.toBeInTheDocument();
    expect(screen.getByTestId("tab-alerts")).toBeInTheDocument();
    expect(screen.getByTestId("tab-baseline")).toBeInTheDocument();
  });

  it("still opens a link to the Playground, so the tab can explain itself", () => {
    h.access.current = { canEdit: false };
    renderAt("/ally?tab=playground");

    expect(screen.getByTestId("playground-tab")).toBeInTheDocument();
  });

  it("opens on the Overview", () => {
    renderAt();

    expect(screen.getByTestId("overview-tab")).toBeInTheDocument();
    expect(screen.getByTestId("tab-overview")).toHaveAttribute("aria-pressed", "true");
  });

  it.each([
    ["conversations", "conversations-tab"],
    ["releases", "releases-tab"],
    ["playground", "playground-tab"],
    ["alerts", "alerts-tab"],
    ["baseline", "baseline-tab"],
    ["settings", "settings-tab"],
    ["crisis-copy", "crisis-copy-tab"],
  ])("opens the %s tab from the address", (tab, testId) => {
    renderAt(`/ally?tab=${tab}`);

    expect(screen.getByTestId(testId)).toBeInTheDocument();
    expect(screen.queryByTestId("overview-tab")).not.toBeInTheDocument();
  });

  it("falls back to the Overview for a tab it does not know, rather than a blank page", () => {
    renderAt("/ally?tab=nonsense");

    expect(screen.getByTestId("overview-tab")).toBeInTheDocument();
  });

  it("puts the chosen tab in the address, so a link opens exactly there", () => {
    renderAt();

    fireEvent.click(screen.getByTestId("tab-releases"));

    expect(screen.getByTestId("releases-tab")).toBeInTheDocument();
    expect(screen.getByTestId("where")).toHaveTextContent("?tab=releases");
  });

  it("takes you from the Overview's live-release tile to the Releases tab", () => {
    renderAt();

    fireEvent.click(screen.getByRole("button", { name: "open releases" }));

    expect(screen.getByTestId("releases-tab")).toBeInTheDocument();
    expect(screen.getByTestId("where")).toHaveTextContent("?tab=releases");
  });

  it("takes you from the Overview's open-alerts tile to the Alerts tab", () => {
    renderAt();

    fireEvent.click(screen.getByRole("button", { name: "open alerts" }));

    expect(screen.getByTestId("alerts-tab")).toBeInTheDocument();
    expect(screen.getByTestId("where")).toHaveTextContent("?tab=alerts");
  });

  it("takes you from a canary on the Releases tab back to the Overview to compare", () => {
    renderAt("/ally?tab=releases");

    fireEvent.click(screen.getByRole("button", { name: "open overview" }));

    expect(screen.getByTestId("overview-tab")).toBeInTheDocument();
    expect(screen.getByTestId("where")).toHaveTextContent("?tab=overview");
  });
});
