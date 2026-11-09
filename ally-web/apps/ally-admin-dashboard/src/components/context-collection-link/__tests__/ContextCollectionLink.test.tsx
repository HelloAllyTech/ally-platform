import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ContextCollectionLink } from "../ContextCollectionLink";

const queryResult = vi.fn();
const querySpy = vi.fn();
vi.mock("@api", () => ({
  useGetContextCollectionsQuery: (arg: unknown, options: unknown) => {
    querySpy(arg, options);
    return queryResult();
  },
}));

const mockUser = vi.fn();
vi.mock("@hooks", () => ({ useUser: () => mockUser() }));

// The real gate, without the `@utils` barrel's store imports.
vi.mock("@utils", async () => import("../../../utils/permissions"));

vi.mock("@constants", () => ({
  FeatureToggleKey: { CONTEXT_LIBRARY: "context_library" },
  Permissions: { VIEW_CONTEXT_LIBRARY: "view:admin:context-library" },
  ROUTES: { CONTEXT_LIBRARY: "/context-library" },
}));

const copy = {
  title: "Builder Lessons",
  description: "What past builds learned.",
  count: (n: number) => (n === 0 ? "No lessons yet" : `${n} ${n === 1 ? "lesson" : "lessons"}`),
  manage: "Manage in Context Library",
  manageLabel: "Manage Builder Lessons in the Context Library",
};

const renderLink = () =>
  render(
    <MemoryRouter>
      <ContextCollectionLink collection="builder_lessons" copy={copy} />
    </MemoryRouter>,
  );

describe("ContextCollectionLink", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser.mockReturnValue({
      features: ["context_library"],
      permissions: ["view:admin:context-library"],
    });
    queryResult.mockReturnValue({
      data: [
        { id: "first_principles", counts: { active: 90 } },
        { id: "builder_lessons", counts: { active: 12, candidate: 3 } },
      ],
    });
  });

  it("links to the collection in the Context Library with its active count", () => {
    renderLink();
    const link = screen.getByRole("link", { name: copy.manageLabel });
    expect(link).toHaveAttribute("href", "/context-library?collection=builder_lessons");
    expect(screen.getByTestId("context-collection-count")).toHaveTextContent("12 lessons");
    expect(screen.getByText(/What past builds learned/)).toBeInTheDocument();
  });

  it("says when there are none yet", () => {
    queryResult.mockReturnValue({ data: [{ id: "builder_lessons", counts: {} }] });
    renderLink();
    expect(screen.getByTestId("context-collection-count")).toHaveTextContent("No lessons yet");
  });

  it("is just the link while the count is loading or unavailable", () => {
    queryResult.mockReturnValue({ data: undefined });
    renderLink();
    expect(screen.queryByTestId("context-collection-count")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: copy.manageLabel })).toBeInTheDocument();
  });

  it("is absent for someone the Context Library would turn away, and never fetches", () => {
    mockUser.mockReturnValue({ features: [], permissions: ["view:admin:context-library"] });
    const { container } = renderLink();
    expect(container).toBeEmptyDOMElement();
    expect(querySpy).toHaveBeenCalledWith(undefined, { skip: true });
  });
});
