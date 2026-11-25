import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

import { AssistantOnlyHeader } from "../AssistantOnlyHeader";
import { ASSISTANT_HEADER_SLOT_ID } from "../headerSlot";

const plan = vi.hoisted(() => ({ data: undefined as unknown, features: [] as string[] }));
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<typeof import("@api")>()),
  useGetMyPlanQuery: () => ({ data: plan.data }),
  useGetFeatureTogglesQuery: () => ({ data: plan.features }),
}));
vi.mock("../../../pages/Credits/MyCredits", () => ({
  MyCreditsPanel: ({ hidePlanLink }: { hidePlanLink?: boolean }) => (
    <div data-testid="credits-panel-stub" data-hide-plan-link={String(Boolean(hidePlanLink))}>
      Credits content
    </div>
  ),
}));
vi.mock("../ChangeLogPanel", () => ({
  ChangeLogPanel: () => <div data-testid="changelog-panel-stub">Change log content</div>,
}));
vi.mock("../../../pages/Plan/MyPlan", () => ({
  MyPlanPanel: () => <div data-testid="seats-panel-stub">Seats content</div>,
}));
const logout = vi.hoisted(() => vi.fn());
vi.mock("@hooks", () => ({
  useUser: () => ({ user: { email: "asha@clinic.example" }, logout }),
}));

const Where: React.FC = () => {
  const { pathname, search } = useLocation();
  return <span data-testid="where">{pathname + search}</span>;
};

const renderAt = (path: string, adminHome?: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <AssistantOnlyHeader adminHome={adminHome} />
      <Where />
    </MemoryRouter>,
  );

const openMenu = () => fireEvent.click(screen.getByTestId("corner-menu-button"));
const openPlanTab = async () => {
  fireEvent.click(screen.getByRole("tab", { name: "Plan and credits" }));
  await screen.findByTestId("credits-panel-stub");
};

describe("AssistantOnlyHeader", () => {
  beforeEach(() => {
    logout.mockClear();
    plan.features = [];
    plan.data = {
      isCreator: true,
      plan: { line: "Free · 1 of 3 assistants published", status: "active" },
    };
  });

  it("is one corner menu: nothing but a menu icon until it is opened", () => {
    renderAt("/assistants");
    expect(screen.getByTestId("corner-menu-button")).toHaveAccessibleName("Account menu");
    expect(screen.getByTestId("corner-menu-button")).not.toHaveTextContent("asha@clinic.example");
    expect(screen.queryByTestId("corner-menu")).not.toBeInTheDocument();
    expect(screen.queryByTestId("assistant-only-logout")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Plan and credits" })).not.toBeInTheDocument();
  });

  it("gives a creator four tabs: About first, with their plan line, then Plan and credits, Seats and plan and Change log", () => {
    renderAt("/assistants");
    openMenu();
    expect(screen.getAllByRole("tab").map(tab => tab.textContent)).toEqual([
      "About",
      "Plan and credits",
      "Seats and plan",
      "Change log",
    ]);
    expect(screen.getByRole("tab", { name: "About" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("assistant-only-plan-line")).toHaveTextContent(
      "Free · 1 of 3 assistants published",
    );
    expect(screen.getByTestId("corner-menu-profile")).toHaveTextContent(
      "Signed in as asha@clinic.example",
    );
    expect(screen.queryByTestId("credits-panel-stub")).not.toBeInTheDocument();
  });

  it("draws the credits content in the drawer on the Plan and credits tab, with no link out", async () => {
    renderAt("/assistants");
    openMenu();
    await openPlanTab();
    expect(screen.getByRole("dialog")).toContainElement(screen.getByTestId("credits-panel-stub"));
    expect(screen.getByRole("tab", { name: "Plan and credits" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.queryByRole("link", { name: "Plan and credits" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "About" }));
    expect(screen.queryByTestId("credits-panel-stub")).not.toBeInTheDocument();
  });

  it("draws Seats and plan in the drawer on its own tab, and the credits tab no longer links to it", async () => {
    renderAt("/assistants");
    openMenu();
    await openPlanTab();
    expect(screen.getByTestId("credits-panel-stub")).toHaveAttribute("data-hide-plan-link", "true");
    fireEvent.click(screen.getByRole("tab", { name: "Seats and plan" }));
    expect(await screen.findByTestId("seats-panel-stub")).toBeInTheDocument();
    expect(screen.queryByTestId("credits-panel-stub")).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { name: "Plan and credits" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("draws the Change log in the drawer as the fourth tab, and ArrowRight wraps back to About", async () => {
    renderAt("/assistants");
    openMenu();
    fireEvent.click(screen.getByRole("tab", { name: "Change log" }));
    expect(await screen.findByTestId("changelog-panel-stub")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Change log" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "About" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByTestId("changelog-panel-stub")).not.toBeInTheDocument();
  });

  it("explains the product on the About tab, for builders and teammates alike", () => {
    renderAt("/assistants");
    openMenu();
    const about = screen.getByTestId("corner-menu-about");
    expect(about).toHaveTextContent("A chatbot your community can trust, built without code.");
    expect(within(about).getByText("How it works")).toBeInTheDocument();
    expect(within(about).getAllByTestId("corner-about-feature")).toHaveLength(9);
    expect(
      within(about)
        .getAllByRole("listitem")
        .map(li => li.querySelector("strong")?.textContent),
    ).toEqual(expect.arrayContaining(["Author", "Editor", "Responder"]));
    expect(within(about).queryByText("Owner")).not.toBeInTheDocument();
    expect(about).not.toHaveTextContent("Builders are");
    cleanup();
    plan.data = { isCreator: false };
    renderAt("/assistants");
    openMenu();
    expect(screen.getByTestId("corner-menu-about")).toBeInTheDocument();
  });

  it("shows the features as a carousel, one at a time, stepped by the arrows", () => {
    renderAt("/assistants");
    openMenu();
    const carousel = screen.getByRole("group", { name: "Features" });
    expect(carousel).toHaveAttribute("aria-roledescription", "carousel");
    expect(screen.getByTestId("corner-about-count")).toHaveTextContent("1 of 9");
    expect(screen.getByTestId("corner-about-prev")).toBeDisabled();
    fireEvent.click(screen.getByTestId("corner-about-next"));
    expect(screen.getByTestId("corner-about-count")).toHaveTextContent("2 of 9");
    expect(screen.getByTestId("corner-about-prev")).toBeEnabled();
    const slides = within(carousel).getAllByTestId("corner-about-feature");
    expect(slides[0]).toHaveAttribute("aria-hidden", "true");
    expect(slides[1]).not.toHaveAttribute("aria-hidden");
    fireEvent.keyDown(carousel, { key: "ArrowLeft" });
    expect(screen.getByTestId("corner-about-count")).toHaveTextContent("1 of 9");
    for (let i = 0; i < 12; i += 1) fireEvent.keyDown(carousel, { key: "ArrowRight" });
    expect(screen.getByTestId("corner-about-count")).toHaveTextContent("9 of 9");
    expect(screen.getByTestId("corner-about-next")).toBeDisabled();
  });

  it("logs out and lands on /assistants, from wherever the drawer was opened", () => {
    renderAt("/assistants/3ca28ccf-31aa-4969-bdf5-b1437f42e9e6?section=settings");
    openMenu();
    fireEvent.click(screen.getByTestId("assistant-only-logout"));
    expect(logout).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("where")).toHaveTextContent(/^\/assistants$/);
    expect(screen.queryByTestId("corner-menu")).not.toBeInTheDocument();
  });

  it("opens as a drawer from the right, with the rest of the content", () => {
    renderAt("/assistants");
    openMenu();
    const drawer = screen.getByRole("dialog", { name: "Account menu" });
    expect(drawer).toHaveAttribute("aria-modal", "true");
    expect(drawer.parentElement?.className).toContain("justify-end");
    expect(drawer).toContainElement(screen.getByTestId("corner-menu-profile"));
    expect(drawer).toContainElement(screen.getByRole("tablist"));
  });

  it("keeps Log out in the drawer header beside the email, on every tab", async () => {
    renderAt("/assistants");
    openMenu();
    const header = screen.getByTestId("corner-menu-profile").parentElement as HTMLElement;
    expect(header).toContainElement(screen.getByTestId("assistant-only-logout"));
    expect(header).toContainElement(screen.getByTestId("corner-menu-close"));
    await openPlanTab();
    expect(screen.getByTestId("assistant-only-logout")).toBeInTheDocument();
  });

  it("closes on Escape, the close button, or a click on the dimmed page, and returns focus", () => {
    renderAt("/assistants");
    openMenu();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("corner-menu")).not.toBeInTheDocument();
    expect(screen.getByTestId("corner-menu-button")).toHaveFocus();
    openMenu();
    fireEvent.click(screen.getByTestId("corner-menu-close"));
    expect(screen.queryByTestId("corner-menu")).not.toBeInTheDocument();
    openMenu();
    fireEvent.click(screen.getByTestId("corner-menu-backdrop"));
    expect(screen.queryByTestId("corner-menu")).not.toBeInTheDocument();
  });

  it("shows an invited teammate with no plan About alone, with no tabs", () => {
    plan.data = { isCreator: false };
    renderAt("/assistants");
    openMenu();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.queryByTestId("assistant-only-plan-line")).not.toBeInTheDocument();
    expect(screen.getByTestId("assistant-only-logout")).toBeInTheDocument();
  });

  it("gives a builder with the Assistants switch the Plan and credits tab even before the plan answers", async () => {
    plan.data = undefined;
    plan.features = ["whatsapp_bot"];
    renderAt("/assistants");
    openMenu();
    await openPlanTab();
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Plan and credits" })).toBeVisible(),
    );
    fireEvent.click(screen.getByRole("tab", { name: "About" }));
    expect(screen.queryByTestId("assistant-only-plan-line")).not.toBeInTheDocument();
  });

  it("on Credits, offers the way back to their assistants", () => {
    renderAt("/account/credits");
    expect(screen.getByRole("link", { name: "Back to Your Ally Chatbots" })).toHaveAttribute(
      "href",
      "/assistants",
    );
  });

  it("gives someone with other Ally admin pages the way back to them", () => {
    renderAt("/assistants/3ca28ccf-31aa-4969-bdf5-b1437f42e9e6", "/simulation-studio");
    expect(screen.getByRole("link", { name: "Back to Ally admin" })).toHaveAttribute(
      "href",
      "/simulation-studio",
    );
    openMenu();
    expect(screen.getByRole("tab", { name: "Plan and credits" })).toBeInTheDocument();
  });

  it("is sticky and holds a slot where a page can draw its own title and action", () => {
    renderAt("/assistants");
    const header = screen.getByTestId("assistant-only-header");
    expect(header.className).toContain("sticky");
    expect(header.querySelector(`#${ASSISTANT_HEADER_SLOT_ID}`)).not.toBeNull();
  });

  it("offers no way back to someone who has only their assistants", () => {
    renderAt("/assistants");
    expect(screen.queryByRole("link", { name: "Back to Ally admin" })).not.toBeInTheDocument();
  });

  it("on Plan and usage, offers the way back to their assistants instead", () => {
    renderAt("/account/plan");
    expect(screen.getByRole("link", { name: "Back to Your Ally Chatbots" })).toHaveAttribute(
      "href",
      "/assistants",
    );
  });
});
