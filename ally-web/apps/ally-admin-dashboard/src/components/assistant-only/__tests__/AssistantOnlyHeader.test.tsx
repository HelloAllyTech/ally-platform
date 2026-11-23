import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

import { AssistantOnlyHeader } from "../AssistantOnlyHeader";

const plan = vi.hoisted(() => ({ data: undefined as unknown }));
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<typeof import("@api")>()),
  useGetMyPlanQuery: () => ({ data: plan.data }),
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

describe("AssistantOnlyHeader", () => {
  beforeEach(() => {
    plan.data = {
      isCreator: true,
      plan: { line: "Free · 1 of 3 assistants published", status: "active" },
    };
  });

  it("gives a creator their plan in one line and the way to Plan and usage", () => {
    renderAt("/assistants");
    expect(screen.getByTestId("assistant-only-plan-line")).toHaveTextContent(
      "Free · 1 of 3 assistants published",
    );
    expect(screen.getByRole("link", { name: "Plan and usage" })).toHaveAttribute(
      "href",
      "/account/plan",
    );
    expect(screen.getByText("asha@clinic.example")).toBeInTheDocument();
  });

  it("shows nothing about plans to an invited teammate with no plan", () => {
    plan.data = { isCreator: false };
    renderAt("/assistants");
    expect(screen.queryByRole("link", { name: "Plan and usage" })).not.toBeInTheDocument();
  });

  it("gives someone with other Ally admin pages the way back to them", () => {
    renderAt("/assistants", "/simulation-studio");
    expect(screen.getByRole("link", { name: "Back to Ally admin" })).toHaveAttribute(
      "href",
      "/simulation-studio",
    );
    expect(screen.getByRole("link", { name: "Plan and usage" })).toBeInTheDocument();
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
    expect(screen.queryByRole("link", { name: "Plan and usage" })).not.toBeInTheDocument();
  });
});
