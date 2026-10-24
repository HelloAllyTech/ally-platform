import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

vi.mock(
  "@ally-ui-mono/ui-shared",
  async () =>
    (await import("../../../components/ally-guide/__tests__/uiSharedFakes")).uiSharedFakes,
);

// Each panel has its own suite; here they only need to say which one is showing.
vi.mock("../EvaluatorPanel", () => ({
  EvaluatorPanel: () => <div data-testid="evaluator-panel" />,
}));
vi.mock("../ReviewsPanel", () => ({ ReviewsPanel: () => <div data-testid="reviews-panel" /> }));
vi.mock("../EvalCasesPanel", () => ({ EvalCasesPanel: () => <div data-testid="cases-panel" /> }));
vi.mock("../DelegationPanel", () => ({
  DelegationPanel: () => <div data-testid="delegation-panel" />,
}));
vi.mock("../CuratorPanel", () => ({ CuratorPanel: () => <div data-testid="curator-panel" /> }));
vi.mock("../SyntheticPanel", () => ({
  SyntheticPanel: () => <div data-testid="synthetic-panel" />,
}));
vi.mock("../EvalRunsPanel", () => ({ EvalRunsPanel: () => <div data-testid="runs-panel" /> }));

// eslint-disable-next-line import/first
import { EvalsTab } from "../EvalsTab";

describe("EvalsTab", () => {
  it("explains the loop and opens on the evaluator", () => {
    render(<EvalsTab />);

    expect(screen.getByTestId("ally-evals")).toHaveTextContent("nightly evaluator");
    expect(screen.getByTestId("ally-evals")).toHaveTextContent(
      "the words of a conversation need the transcripts permission",
    );
    expect(screen.getByTestId("evaluator-panel")).toBeInTheDocument();
  });

  it.each([
    ["Reviews", "reviews-panel"],
    ["Cases", "cases-panel"],
    ["Runs", "runs-panel"],
    ["Curator", "curator-panel"],
    ["Synthetic", "synthetic-panel"],
    ["Evaluator", "evaluator-panel"],
  ])("shows the %s view when chosen, and only that one", (name, testId) => {
    render(<EvalsTab />);

    fireEvent.click(screen.getByRole("button", { name }));

    expect(screen.getByTestId(testId)).toBeInTheDocument();
    // The delegation stage sits above every view; exactly one view shows beneath it.
    expect(screen.getByTestId("delegation-panel")).toBeInTheDocument();
    expect(
      screen.getAllByTestId(/-panel$/).filter(el => el.dataset.testid !== "delegation-panel"),
    ).toHaveLength(1);
  });

  it("can open on another view", () => {
    render(<EvalsTab initialView="runs" />);

    expect(screen.getByTestId("runs-panel")).toBeInTheDocument();
  });
});
