import React from "react";

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SkillExperimentVariant } from "@types";

import { VariantList } from "../VariantList";

vi.mock("@icons", () => ({
  ThumbsUp: () => <div data-testid="thumbs-up" />,
  ThumbsDown: () => <div data-testid="thumbs-down" />,
}));

vi.mock("../ExperimentStatusBadge", () => ({
  VariantStatusBadge: ({ status }: any) => <div>{status}</div>,
}));

vi.mock("../VariantOutputs", () => ({
  VariantOutputs: () => <div>Outputs</div>,
}));

describe("VariantList", () => {
  const mockVariant = (patch: Partial<SkillExperimentVariant>): SkillExperimentVariant => ({
    id: "v1",
    run: 1,
    ordinal: 1,
    label: "Variant 1",
    isOriginal: true,
    content: "Some content",
    status: "champion",
    changeSummary: null,
    hypothesis: null,
    designerModel: null,
    statusReason: null,
    launchedAt: null,
    retiredAt: null,
    judgedCount: 10,
    meanScore: 80,
    scoreStdDev: null,
    criterionMeans: null,
    formatFailures: 0,
    createdAt: new Date().toISOString(),
    ...patch,
  });

  it("shows thumbs-up/down counts when judgeModel is 'user-feedback'", () => {
    render(
      <VariantList
        promptId="p1"
        variants={[mockVariant({ meanScore: 80, judgedCount: 10 })]}
        currentRun={1}
        rubric={[]}
        challengerPercent={10}
        live={true}
        judgeModel="user-feedback"
      />,
    );

    // positiveCount = Math.round(80 / 100 * 10) = 8
    // negativeCount = 10 - 8 = 2
    expect(screen.getByTestId("positive-count")).toHaveTextContent("8");
    expect(screen.getByTestId("negative-count")).toHaveTextContent("2");
    expect(screen.getByTestId("thumbs-up")).toBeInTheDocument();
    expect(screen.getByTestId("thumbs-down")).toBeInTheDocument();
  });

  it("does not show thumbs counts when judgeModel is not 'user-feedback'", () => {
    render(
      <VariantList
        promptId="p1"
        variants={[mockVariant({ meanScore: 80, judgedCount: 10 })]}
        currentRun={1}
        rubric={[]}
        challengerPercent={10}
        live={true}
        judgeModel="gpt-4"
      />,
    );

    expect(screen.queryByText("8")).not.toBeInTheDocument();
    expect(screen.queryByText("2")).not.toBeInTheDocument();
    expect(screen.queryByTestId("thumbs-up")).not.toBeInTheDocument();
  });
});
