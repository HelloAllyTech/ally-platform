import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

const h = vi.hoisted(() => ({
  access: { current: { canEdit: true } as Record<string, boolean> },
}));

vi.mock("@hooks", () => ({ useAllyGuideAccess: () => h.access.current }));
// The panel has its own suite; here it only needs to say which scope it was given.
vi.mock("@components/ally-guide/LibraryPanel", () => ({
  LibraryPanel: ({ scope, canEdit }: { scope: string; canEdit: boolean }) => (
    <div data-testid="library-panel" data-scope={scope} data-can-edit={String(canEdit)} />
  ),
}));

// eslint-disable-next-line import/first
import { LibraryTab } from "../LibraryTab";

describe("LibraryTab", () => {
  beforeEach(() => {
    h.access.current = { canEdit: true };
  });

  it("shows the platform's library, never an organisation's", () => {
    render(<LibraryTab />);

    expect(screen.getByTestId("library-panel")).toHaveAttribute("data-scope", "platform");
  });

  it("lets an admin who can edit change it, and one who cannot only read it", () => {
    const { unmount } = render(<LibraryTab />);
    expect(screen.getByTestId("library-panel")).toHaveAttribute("data-can-edit", "true");
    unmount();

    h.access.current = { canEdit: false };
    render(<LibraryTab />);
    expect(screen.getByTestId("library-panel")).toHaveAttribute("data-can-edit", "false");
  });
});
