import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CharacterInsightsCard } from "../CharacterInsightsCard";

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
  en: {
    characterInsights: {
      title: "Character Insights",
      description: "What the interview draws on.",
      count: (n: number) =>
        n === 0 ? "No insights yet" : `${n} ${n === 1 ? "insight" : "insights"}`,
      manage: "Manage in Context Library",
      manageLabel: "Manage Character Insights in the Context Library",
    },
  },
}));

const collection = (id: string, active?: number) => ({
  id,
  counts: active === undefined ? {} : { active, archived: 3 },
});

const renderCard = (compact?: boolean) =>
  render(
    <MemoryRouter>
      <CharacterInsightsCard compact={compact} />
    </MemoryRouter>,
  );

describe("CharacterInsightsCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser.mockReturnValue({
      features: ["context_library"],
      permissions: ["view:admin:context-library"],
    });
    queryResult.mockReturnValue({
      data: [collection("first_principles", 90), collection("character_insights", 42)],
    });
  });

  it("links to the Character Insights collection in the Context Library", () => {
    renderCard();
    expect(
      screen.getByRole("link", { name: "Manage Character Insights in the Context Library" }),
    ).toHaveAttribute("href", "/context-library?collection=character_insights");
    expect(screen.getByText("What the interview draws on.", { exact: false })).toBeInTheDocument();
  });

  it("counts the collection's active insights, not every collection's or archived ones", () => {
    renderCard();
    expect(screen.getByTestId("character-insights-count")).toHaveTextContent("42 insights");
  });

  it("says so plainly when there are none yet", () => {
    queryResult.mockReturnValue({ data: [collection("character_insights")] });
    renderCard();
    expect(screen.getByTestId("character-insights-count")).toHaveTextContent("No insights yet");
  });

  it("is just the link while the count is loading or unavailable", () => {
    queryResult.mockReturnValue({ data: undefined, isError: true });
    renderCard();
    expect(screen.getByTestId("character-insights-link")).toBeInTheDocument();
    expect(screen.queryByTestId("character-insights-count")).toBeNull();
  });

  it("is one link in its compact form", () => {
    renderCard(true);
    expect(screen.queryByTestId("character-insights-card")).toBeNull();
    expect(screen.getByTestId("character-insights-link")).toHaveAttribute(
      "href",
      "/context-library?collection=character_insights",
    );
    expect(screen.getByTestId("character-insights-count")).toHaveTextContent("42 insights");
  });

  it.each([
    ["without the Context Library permission", ["context_library"], []],
    ["without the Context Library feature", [], ["view:admin:context-library"]],
  ])("is hidden, and asks for nothing, %s", (_case, features, permissions) => {
    mockUser.mockReturnValue({ features, permissions });
    const { container } = renderCard();
    expect(container).toBeEmptyDOMElement();
    expect(querySpy).toHaveBeenCalledWith(undefined, { skip: true });
  });

  it("never calls the material chunks", () => {
    const { container } = renderCard();
    expect(container.textContent).not.toMatch(/chunk/i);
  });
});
