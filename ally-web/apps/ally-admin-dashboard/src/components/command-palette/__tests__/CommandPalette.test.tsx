import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({
  items: [
    { id: "simulation-studio", label: "Roleplays", path: "/simulation-studio", section: "create" },
    { id: "events", label: "Events", path: "/manage-events", section: "create" },
    { id: "users", label: "Users", path: "/user-management", section: "people" },
    { id: "analytics", label: "Analytics", path: "/analytics", section: "insights" },
    {
      id: "conversation-drift",
      label: "Conversation Drift",
      path: "/analytics?tab=drift",
      section: "insights",
    },
    { id: "ai-tasks", label: "AI Tasks", path: "/ai-tasks", section: "ai-languages" },
  ],
}));

// Only the nav list the user can see: the palette must show exactly this, never more.
vi.mock("@hooks", () => ({ useUser: () => ({ filteredNavigationItems: nav.items }) }));

import { CommandPaletteProvider } from "../CommandPaletteProvider";
import { useCommandPalette } from "../CommandPaletteContext";

const Where: React.FC = () => {
  const location = useLocation();
  return <div data-testid="where">{location.pathname + location.search}</div>;
};
const Opener: React.FC = () => {
  const { open } = useCommandPalette();
  return (
    <button type="button" onClick={open}>
      open palette
    </button>
  );
};

const renderAt = (path = "/simulation-studio") =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <CommandPaletteProvider>
        <Where />
        <Opener />
      </CommandPaletteProvider>
    </MemoryRouter>,
  );

const openWithShortcut = (init: KeyboardEventInit = { key: "k", metaKey: true }) =>
  fireEvent.keyDown(document, init);

describe("CommandPalette", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("is closed until Cmd+K or Ctrl+K, and the shortcut toggles it", () => {
    renderAt();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    openWithShortcut();
    expect(screen.getByRole("dialog", { name: "Go to a page" })).toBeInTheDocument();
    openWithShortcut({ key: "k", ctrlKey: true });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    openWithShortcut({ key: "K", ctrlKey: true });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("does not react to a bare k", () => {
    renderAt();
    openWithShortcut({ key: "k" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens from the context (the sidebar's search button) and focuses the box", () => {
    renderAt();
    fireEvent.click(screen.getByText("open palette"));
    expect(screen.getByRole("combobox")).toHaveFocus();
  });

  it("lists every page the user can see, grouped by section, and nothing else", () => {
    renderAt();
    openWithShortcut();
    const options = screen.getAllByRole("option").map(o => o.textContent);
    expect(options).toEqual(
      expect.arrayContaining(["Roleplays", "Events", "Users", "Analytics", "AI Tasks"]),
    );
    expect(options).toHaveLength(nav.items.length);
    expect(screen.queryByText("Roadmap")).not.toBeInTheDocument();
  });

  it("fuzzy-matches and opens the best hit on Enter, then closes", () => {
    renderAt();
    openWithShortcut();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "aitk" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    expect(screen.getByTestId("where")).toHaveTextContent("/ai-tasks");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens a page that lives on a query string (Conversation Drift)", () => {
    renderAt();
    openWithShortcut();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "drift" } });
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    expect(screen.getByTestId("where")).toHaveTextContent("/analytics?tab=drift");
  });

  it("moves with the arrow keys (wrapping), exposes the choice to assistive tech, and Enter opens it", () => {
    renderAt();
    openWithShortcut();
    const box = screen.getByRole("combobox");
    const selected = () =>
      screen.getAllByRole("option").find(o => o.getAttribute("aria-selected") === "true")!;
    expect(selected()).toHaveTextContent("Roleplays");
    fireEvent.keyDown(box, { key: "ArrowDown" });
    expect(selected()).toHaveTextContent("Events");
    expect(box).toHaveAttribute("aria-activedescendant", selected().id);
    fireEvent.keyDown(box, { key: "ArrowUp" });
    fireEvent.keyDown(box, { key: "ArrowUp" });
    expect(selected()).toHaveTextContent("AI Tasks"); // wrapped to the end
    fireEvent.keyDown(box, { key: "Enter" });
    expect(screen.getByTestId("where")).toHaveTextContent("/ai-tasks");
  });

  it("closes on Escape and on a click outside", () => {
    renderAt();
    openWithShortcut();
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    openWithShortcut();
    fireEvent.mouseDown(screen.getByTestId("command-palette-overlay"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("says so when nothing matches, and Enter then does nothing", () => {
    renderAt();
    openWithShortcut();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "zzzzqq" } });
    expect(screen.getByText("No page matches that.")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByTestId("where")).toHaveTextContent("/simulation-studio");
  });

  it("shows the pages you opened lately first, without the one you are on", () => {
    renderAt("/user-management");
    // Landing on Users recorded it; visit two more through the palette.
    openWithShortcut();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "events" } });
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    openWithShortcut();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "analytics" } });
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });

    openWithShortcut();
    const options = screen.getAllByRole("option").map(o => o.textContent);
    expect(screen.getByText("Recent")).toBeInTheDocument();
    // Newest first, and the current page (Analytics) is not among them; it stays listed under Pages.
    expect(options.slice(0, 2)).toEqual(["Events", "Users"]);
    expect(options.indexOf("Analytics")).toBeGreaterThan(1);
    expect(options).toHaveLength(nav.items.length);
  });

  it("ignores a recent page the user can no longer see", () => {
    localStorage.setItem("admin_command_palette_recents", JSON.stringify(["roadmap", "events"]));
    renderAt();
    openWithShortcut();
    const options = screen.getAllByRole("option").map(o => o.textContent);
    expect(options[0]).toBe("Events");
    expect(options).not.toContain("Roadmap");
  });
});
