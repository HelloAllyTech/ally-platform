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

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <AssistantOnlyHeader />
    </MemoryRouter>,
  );

describe("AssistantOnlyHeader", () => {
  beforeEach(() => {
    plan.data = {
      isCreator: true,
      tokens: null,
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

  it("links someone with only a token allowance too", () => {
    plan.data = { isCreator: false, tokens: { unlimited: false, left: 5, granted: 10 } };
    renderAt("/assistants");
    expect(screen.getByRole("link", { name: "Plan and usage" })).toBeInTheDocument();
    expect(screen.queryByTestId("assistant-only-plan-line")).not.toBeInTheDocument();
  });

  it("shows nothing about plans to an invited teammate with no plan and no tokens", () => {
    plan.data = { isCreator: false, tokens: null };
    renderAt("/assistants");
    expect(screen.queryByRole("link", { name: "Plan and usage" })).not.toBeInTheDocument();
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
