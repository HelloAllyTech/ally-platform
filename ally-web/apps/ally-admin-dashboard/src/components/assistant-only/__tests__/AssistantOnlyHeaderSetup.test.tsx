import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

import { AssistantOnlyHeader } from "../AssistantOnlyHeader";

vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<typeof import("@api")>()),
  useGetMyPlanQuery: () => ({ data: { isCreator: false } }),
  useGetFeatureTogglesQuery: () => ({ data: [] }),
}));
vi.mock("@hooks", () => ({
  useUser: () => ({ user: { email: "asha@clinic.example" }, logout: vi.fn() }),
}));

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <AssistantOnlyHeader adminHome="/simulation-studio" />
    </MemoryRouter>,
  );

describe("AssistantOnlyHeader while setting up an assistant", () => {
  it.each(["/assistants/new", "/assistants/new/3ca28ccf-31aa-4969-bdf5-b1437f42e9e6"])(
    "has no link out to Ally admin on %s",
    path => {
      renderAt(path);
      expect(screen.queryByRole("link", { name: "Back to Ally admin" })).not.toBeInTheDocument();
      expect(screen.getByTestId("corner-menu-button")).toBeInTheDocument();
    },
  );

  it("keeps the link on the assistants list", () => {
    renderAt("/assistants");
    expect(screen.getByRole("link", { name: "Back to Ally admin" })).toBeInTheDocument();
  });
});
