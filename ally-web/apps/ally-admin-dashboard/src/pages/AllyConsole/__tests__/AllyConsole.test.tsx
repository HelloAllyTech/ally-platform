import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work, and a mock registered after
// another import that pulls it in arrives too late.
import "@constants";

vi.mock(
  "@ally-ui-mono/ui-shared",
  async () =>
    (await import("../../../components/ally-guide/__tests__/uiSharedFakes")).uiSharedFakes,
);

// Each tab has its own suite; here they only need to say which one is showing.
vi.mock("../OverviewTab", () => ({
  OverviewTab: ({ onOpenReleases }: { onOpenReleases: () => void }) => (
    <div data-testid="overview-tab">
      <button type="button" onClick={onOpenReleases}>
        open releases
      </button>
    </div>
  ),
}));
vi.mock("../ConversationsTab", () => ({
  ConversationsTab: () => <div data-testid="conversations-tab" />,
}));
vi.mock("../ReleasesTab", () => ({ ReleasesTab: () => <div data-testid="releases-tab" /> }));
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
  it("titles the page and says what it is for", () => {
    renderAt();

    expect(screen.getByRole("heading", { level: 1, name: "Ally Console" })).toBeInTheDocument();
    expect(screen.getByText(/control room for Ally/)).toBeInTheDocument();
  });

  it("offers exactly the five tabs, in order", () => {
    renderAt();

    expect(
      ["overview", "conversations", "releases", "settings", "crisis-copy"].map(
        id => screen.getByTestId(`tab-${id}`).textContent,
      ),
    ).toEqual(["Overview", "Conversations", "Releases", "Settings", "Crisis copy"]);
  });

  it("opens on the Overview", () => {
    renderAt();

    expect(screen.getByTestId("overview-tab")).toBeInTheDocument();
    expect(screen.getByTestId("tab-overview")).toHaveAttribute("aria-pressed", "true");
  });

  it.each([
    ["conversations", "conversations-tab"],
    ["releases", "releases-tab"],
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
});
