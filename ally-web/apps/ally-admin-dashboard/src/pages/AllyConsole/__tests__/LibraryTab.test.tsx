import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

// The link has its own suite; here it only needs to say where it points.
vi.mock("@components/context-collection-link", () => ({
  ContextCollectionLink: ({
    collection,
    copy,
    tenantId,
  }: {
    collection: string;
    copy: { title: string };
    tenantId?: string;
  }) => (
    <div data-testid="collection-link" data-collection={collection} data-tenant={tenantId ?? ""}>
      {copy.title}
    </div>
  ),
}));

// eslint-disable-next-line import/first
import { LibraryTab } from "../LibraryTab";

describe("LibraryTab", () => {
  it("points at the Ally Guide Library in the Context Library, for every organisation", () => {
    render(<LibraryTab />);

    const link = screen.getByTestId("collection-link");
    expect(link).toHaveAttribute("data-collection", "ally_guide_library");
    expect(link).toHaveAttribute("data-tenant", "");
    expect(link).toHaveTextContent("Ally Guide Library");
  });
});
