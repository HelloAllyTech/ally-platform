import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { BuilderPrdDocument, BuilderPrdReadiness } from "@types";

vi.mock("@components", () => ({ cellTypes: {} }));
vi.mock("@assets", () => ({ TooltipIcon: () => <svg /> }));
vi.mock("@ally-ui-mono/ui-shared", () => ({
  Tag: ({ children }: any) => <span>{children}</span>,
  Tooltip: ({ children }: any) => <>{children}</>,
}));
vi.mock("../../context-citation", () => ({
  CitationChip: ({ code }: any) => <span>[{code}]</span>,
}));

// eslint-disable-next-line import/first
import { PrdCoverageList } from "../PrdCoverageList";
// eslint-disable-next-line import/first
import { PrdPrincipleMarks } from "../PrdPrincipleMarks";

const prd = (extra: Partial<BuilderPrdDocument> = {}) =>
  ({
    title: "",
    summary: "",
    problem: "",
    usersAndContext: "",
    existingBehaviour: "",
    whereChangesBelong: "",
    goals: "",
    nonGoals: "",
    requirements: [],
    assumptions: [],
    technicalPlan: { repos: [], dataModelMd: "", apiMd: "" },
    testPlanMd: "",
    e2ePlanMd: "",
    openQuestions: [],
    ...extra,
  }) as BuilderPrdDocument;

const readiness = (extra: Partial<BuilderPrdReadiness> = {}): BuilderPrdReadiness => ({
  score: 0,
  ready: false,
  sections: [],
  blockers: [],
  ...extra,
});

describe("PrdCoverageList", () => {
  it("lists every item with its answer, and the open ones as not covered", () => {
    render(
      <PrdCoverageList
        prd={prd({
          coverage: [
            {
              key: "mobile_app",
              status: "not_applicable",
              note: "No learner screen changes",
            },
            {
              key: "success_metric",
              status: "answered",
              note: "Plans closed per week",
              section: "goals",
            },
          ],
        })}
      />,
    );
    expect(screen.getByText("2 of 10 covered")).toBeInTheDocument();
    const mobile = screen.getByTestId("coverage-mobile_app");
    expect(within(mobile).getByText("Not applicable")).toBeInTheDocument();
    expect(within(mobile).getByText(/No learner screen changes/)).toBeInTheDocument();
    expect(
      within(screen.getByTestId("coverage-success_metric")).getByText(/In Goals/),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("coverage-translations")).getByText("Not covered"),
    ).toBeInTheDocument();
  });

  it("renders nothing for an older PRD the server does not assess", () => {
    const { container } = render(<PrdCoverageList prd={prd()} assessed={false} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("PrdPrincipleMarks", () => {
  it("shows each principle in the brief with its mark", () => {
    render(
      <PrdPrincipleMarks
        prd={prd({
          principleMarks: [
            { code: "FP-0142", mark: "applied", section: "goals" },
            { code: "BL-0036", mark: "not_relevant", reason: "No requirements change" },
          ],
        })}
        readiness={readiness({
          principles: {
            enabled: true,
            inBrief: ["FP-0142", "BL-0036", "FP-2493"],
            retrieved: 9,
            unmarked: ["FP-2493"],
          },
        })}
      />,
    );
    expect(
      within(screen.getByTestId("principle-FP-0142")).getByText("Applied"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("principle-FP-0142")).getByText("In Goals"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("principle-BL-0036")).getByText("No requirements change"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("principle-FP-2493")).getByText("Not marked"),
    ).toBeInTheDocument();
  });

  it("warns when the session retrieved no principles", () => {
    render(
      <PrdPrincipleMarks
        prd={prd()}
        readiness={readiness({
          principles: { enabled: true, inBrief: [], retrieved: 0, unmarked: [] },
        })}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(/No principles were retrieved/);
  });

  it("renders nothing without a summary or marks", () => {
    const { container } = render(<PrdPrincipleMarks prd={prd()} readiness={readiness()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
