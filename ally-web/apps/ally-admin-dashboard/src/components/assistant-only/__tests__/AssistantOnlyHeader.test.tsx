import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

import { AssistantOnlyHeader } from "../AssistantOnlyHeader";

const plan = vi.hoisted(() => ({ data: undefined as unknown, features: [] as string[] }));
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<typeof import("@api")>()),
  useGetMyPlanQuery: () => ({ data: plan.data }),
  useGetFeatureTogglesQuery: () => ({ data: plan.features }),
}));
vi.mock("@hooks", () => ({
  useUser: () => ({ user: { email: "asha@clinic.example" }, logout: vi.fn() }),
}));

const renderAt = (path: string, adminHome?: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <AssistantOnlyHeader adminHome={adminHome} />
    </MemoryRouter>,
  );

const openMenu = () => fireEvent.click(screen.getByTestId("corner-menu-button"));

describe("AssistantOnlyHeader", () => {
  beforeEach(() => {
    plan.features = [];
    plan.data = {
      isCreator: true,
      plan: { line: "Free · 1 of 3 assistants published", status: "active" },
    };
  });

  it("is one corner menu: nothing but the menu button until it is opened", () => {
    renderAt("/assistants");
    expect(screen.getByTestId("corner-menu-button")).toHaveTextContent("asha@clinic.example");
    expect(screen.queryByTestId("assistant-only-logout")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Plan and credits" })).not.toBeInTheDocument();
  });

  it("gives a creator their plan in one line and the way to Plan and credits", () => {
    renderAt("/assistants");
    openMenu();
    expect(screen.getByTestId("assistant-only-plan-line")).toHaveTextContent(
      "Free · 1 of 3 assistants published",
    );
    expect(screen.getByRole("menuitem", { name: "Plan and credits" })).toHaveAttribute(
      "href",
      "/account/credits",
    );
    expect(screen.getByTestId("corner-menu-profile")).toHaveTextContent("asha@clinic.example");
    expect(screen.getByTestId("assistant-only-logout")).toBeInTheDocument();
  });

  it("closes on Escape", () => {
    renderAt("/assistants");
    openMenu();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("corner-menu")).not.toBeInTheDocument();
  });

  it("shows nothing about plans to an invited teammate with no plan", () => {
    plan.data = { isCreator: false };
    renderAt("/assistants");
    openMenu();
    expect(screen.queryByRole("menuitem", { name: "Plan and credits" })).not.toBeInTheDocument();
    expect(screen.getByTestId("assistant-only-logout")).toBeInTheDocument();
  });

  it("gives a builder with the Assistants switch Plan and credits even before the plan answers", () => {
    plan.data = undefined;
    plan.features = ["whatsapp_bot"];
    renderAt("/assistants");
    openMenu();
    expect(screen.getByRole("menuitem", { name: "Plan and credits" })).toHaveAttribute(
      "href",
      "/account/credits",
    );
    expect(screen.queryByTestId("assistant-only-plan-line")).not.toBeInTheDocument();
  });

  it("on Credits, offers the way back to their assistants", () => {
    renderAt("/account/credits");
    expect(screen.getByRole("link", { name: "Go to your assistants" })).toHaveAttribute(
      "href",
      "/assistants",
    );
  });

  it("gives someone with other Ally admin pages the way back to them", () => {
    renderAt("/assistants", "/simulation-studio");
    expect(screen.getByRole("link", { name: "Back to Ally admin" })).toHaveAttribute(
      "href",
      "/simulation-studio",
    );
    openMenu();
    expect(screen.getByRole("menuitem", { name: "Plan and credits" })).toBeInTheDocument();
  });

  it("offers no way back to someone who has only their assistants", () => {
    renderAt("/assistants");
    expect(screen.queryByRole("link", { name: "Back to Ally admin" })).not.toBeInTheDocument();
  });

  it("on Plan and usage, offers the way back to their assistants instead", () => {
    renderAt("/account/plan");
    expect(screen.getByRole("link", { name: "Go to your assistants" })).toHaveAttribute(
      "href",
      "/assistants",
    );
  });
});
