import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@components", () => ({ cellTypes: {} }));

let result: any;
const refetch = vi.fn();
vi.mock("@api", () => ({
  useGetCourseCopilotStagesQuery: () => result,
}));

// eslint-disable-next-line import/first
import { StagesPanel } from "../StagesPanel";

const stage = (over: any) => ({
  id: "x",
  title: "Stage",
  group: "interview",
  status: "passed",
  why: "Passed.",
  what: "Does a thing.",
  enteredAt: null,
  leftAt: null,
  checks: [],
  events: [],
  ...over,
});

describe("StagesPanel", () => {
  it("groups the stages and opens the one that failed", () => {
    result = {
      isLoading: false,
      isError: false,
      refetch,
      data: {
        staged: true,
        sessionStatus: "BUILD_FAILED",
        stages: [
          stage({ id: "intake", title: "What the course is for" }),
          stage({
            id: "build",
            title: "Build",
            group: "build",
            status: "failed",
            why: "1 job failed; the build stopped.",
            checks: [{ label: "Failed: Intro (article)", result: "fail", detail: "timeout" }],
            events: [{ at: "2026-11-27T10:00:00Z", kind: "job", text: "Intro: timeout" }],
          }),
        ],
      },
    };
    render(<StagesPanel sessionId="s1" />);

    expect(screen.getByText("Interview")).toBeInTheDocument();
    expect(screen.getByText("What the course is for")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("1 job failed; the build stopped.")).toBeInTheDocument();
    expect(screen.getByTestId("stage-build")).toHaveAttribute("open");
    expect(screen.getByTestId("stage-intake")).not.toHaveAttribute("open");
    expect(screen.getByText("Failed: Intro (article)")).toBeInTheDocument();
    expect(screen.getByText("timeout")).toBeInTheDocument();
  });

  it("shows research points with their sources", () => {
    result = {
      isLoading: false,
      isError: false,
      refetch,
      data: {
        staged: true,
        sessionStatus: "INTERVIEWING",
        stages: [
          stage({
            id: "brief.learners",
            status: "current",
            researchState: "found",
            research: {
              question: "Who are they?",
              summary: "",
              points: [
                {
                  text: "New volunteers fear saying the wrong thing",
                  sources: ["Learner profile: Helpline responders"],
                },
              ],
              gaps: [],
            },
          }),
        ],
      },
    };
    render(<StagesPanel sessionId="s1" />);
    expect(screen.getByText(/New volunteers fear saying the wrong thing/)).toBeInTheDocument();
    expect(screen.getByText("[Learner profile: Helpline responders]")).toBeInTheDocument();
  });

  it("names the sub-agents on the row, and what each did inside it", () => {
    result = {
      isLoading: false,
      isError: false,
      refetch,
      data: {
        staged: true,
        sessionStatus: "AWAITING_BLUEPRINT",
        stages: [
          stage({
            id: "blueprint",
            title: "Plan",
            group: "plan",
            status: "warning",
            agents: [
              { name: "Planner", role: "Drafts the course", state: "ran", detail: "repair kept" },
              { name: "Critic", role: "Reviews the plan", state: "off", detail: "Switched off" },
            ],
          }),
        ],
      },
    };
    render(<StagesPanel sessionId="s1" />);
    const row = screen.getByTestId("stage-blueprint");
    expect(row).toHaveTextContent("Planner");
    expect(row).toHaveTextContent("Critic");
    expect(screen.getByText("Who worked here")).toBeInTheDocument();
    expect(row).toHaveTextContent("Ran · repair kept");
    expect(row).toHaveTextContent("Off · Switched off");
  });

  it("offers a retry when the report fails to load", () => {
    result = { isLoading: false, isError: true, data: undefined, refetch };
    render(<StagesPanel sessionId="s1" />);
    fireEvent.click(screen.getByText("Try again"));
    expect(refetch).toHaveBeenCalled();
  });

  it("says when the stages were switched off for the session", () => {
    result = {
      isLoading: false,
      isError: false,
      refetch,
      data: { staged: false, sessionStatus: "EDITING", stages: [] },
    };
    render(<StagesPanel sessionId="s1" />);
    expect(screen.getByText(/switched off for this session/)).toBeInTheDocument();
  });
});
