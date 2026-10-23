import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CourseCopilotBlueprintResponse, CourseCopilotSessionDetail } from "@types";

// @constants reads off the @components barrel at module-eval time (see the Builder
// tests), so the barrel is stubbed rather than loaded for real.
vi.mock("@components", () => ({ cellTypes: {} }));

// The panels have their own tests; here they only say which one is showing and what they were
// handed. BriefPanel can be made to throw, to prove one bad panel does not take the pane down.
vi.mock("../BriefPanel", () => ({
  BriefPanel: (props: any) => {
    if (props.brief?.seed === "boom") throw new Error("malformed brief");
    return <div data-testid="brief-panel" data-seed={props.brief?.seed ?? ""} />;
  },
}));
vi.mock("../BlueprintTree", () => ({
  BlueprintTree: (props: any) => (
    <div
      data-testid="blueprint-panel"
      data-editable={String(props.editable)}
      data-version={String(props.version)}
      data-busy={String(Boolean(props.isBusy))}
      data-title={props.blueprint.title}
    />
  ),
}));
vi.mock("../BuildPanel", () => ({
  BuildPanel: (props: any) => (
    <div data-testid="build-panel" data-editor-disabled={props.openEditorDisabledReason ?? ""} />
  ),
}));
vi.mock("../CourseOutlinePanel", () => ({
  CourseOutlinePanel: (props: any) => (
    <div
      data-testid="course-panel"
      data-editor-disabled={props.openEditorDisabledReason ?? ""}
      data-can-ask={String(Boolean(props.onAskCopilot))}
    >
      <button
        onClick={() =>
          props.onAskCopilot?.({ key: "cover", label: "Cover image", ok: false, detail: "Needed" })
        }
      >
        ask
      </button>
    </div>
  ),
}));

// eslint-disable-next-line import/first
import { CourseCopilotWorkPane, CourseCopilotWorkPaneProps } from "../CourseCopilotWorkPane";
// eslint-disable-next-line import/first
import { job, makeBlueprint, makeDetail, outline } from "./fixtures";

type Status = CourseCopilotSessionDetail["session"]["status"];

const blueprintFor = (title = "Listening basics") => ({ ...makeBlueprint(), title });

const response = (version: number, title = "Listening basics"): CourseCopilotBlueprintResponse => ({
  blueprint: blueprintFor(title),
  version,
  estimate: makeBlueprint().estimate,
  budget: { ceilingUsd: 10, spentUsd: 0, remainingUsd: 10, held: false },
  problems: [],
});

/** A session in `status`, carrying the data that status normally has. */
const detailIn = (status: Status): CourseCopilotSessionDetail => {
  switch (status) {
    case "AWAITING_BLUEPRINT":
      return makeDetail({
        status,
        session: { blueprint: blueprintFor(), blueprintVersion: 2 },
      });
    case "BUILDING":
    case "BUILD_FAILED":
      return makeDetail({
        status,
        session: {
          blueprint: blueprintFor(),
          blueprintVersion: 2,
          approvedBlueprint: blueprintFor("Approved"),
        },
        detail: { jobs: [job()] },
      });
    case "EDITING":
    case "ARCHIVED":
      return makeDetail({
        status,
        session: {
          blueprint: blueprintFor(),
          blueprintVersion: 2,
          approvedBlueprint: blueprintFor("Approved"),
        },
        detail: { jobs: [job({ status: "done" })], outline: outline() },
      });
    default:
      return makeDetail({ status });
  }
};

const handlers = () => ({
  onBlueprintSave: vi.fn().mockResolvedValue(null),
  onApprove: vi.fn().mockResolvedValue(true),
  onRetryJobs: vi.fn().mockResolvedValue(undefined),
  onCancelBuild: vi.fn().mockResolvedValue(undefined),
  onRaiseBudget: vi.fn().mockResolvedValue(true),
  onOpenEditor: vi.fn(),
  onSendMessage: vi.fn(),
});

const setup = (detail: CourseCopilotSessionDetail, overrides: Partial<CourseCopilotWorkPaneProps> = {}) => {
  const props: CourseCopilotWorkPaneProps = { detail, ...handlers(), ...overrides };
  const utils = render(<CourseCopilotWorkPane {...props} />);
  return {
    ...utils,
    props,
    update: (next: Partial<CourseCopilotWorkPaneProps>) =>
      utils.rerender(<CourseCopilotWorkPane {...props} {...next} />),
  };
};

const shown = () =>
  ["brief", "blueprint", "build", "course"].find(name => screen.queryByTestId(`${name}-panel`));

const tab = (name: string) => screen.getByRole("tab", { name: new RegExp(`^${name}`) });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CourseCopilotWorkPane — default tab per status", () => {
  it.each<[Status, string]>([
    ["INTERVIEWING", "brief"],
    ["AWAITING_BLUEPRINT", "blueprint"],
    ["BUILDING", "build"],
    ["BUILD_FAILED", "build"],
    ["EDITING", "course"],
    ["ARCHIVED", "course"],
  ])("%s opens on %s", (status, expected) => {
    setup(detailIn(status));

    expect(shown()).toBe(expected);
    expect(tab(expected[0].toUpperCase() + expected.slice(1))).toHaveAttribute("aria-selected", "true");
  });

  it("opens an archived session with no course on the brief", () => {
    setup(makeDetail({ status: "ARCHIVED" }));
    expect(shown()).toBe("brief");
  });
});

describe("CourseCopilotWorkPane — which tabs are available", () => {
  it("enables only the tabs whose data exists", () => {
    setup(makeDetail({ status: "INTERVIEWING" }));

    expect(tab("Brief")).toBeEnabled();
    expect(tab("Blueprint")).toBeDisabled();
    expect(tab("Build")).toBeDisabled();
    expect(tab("Course")).toBeDisabled();
  });

  it("lets the trainer look back at the approved blueprint and the build once editing", () => {
    setup(detailIn("EDITING"));

    expect(tab("Blueprint")).toBeEnabled();
    expect(tab("Build")).toBeEnabled();
    fireEvent.click(tab("Blueprint"));

    const blueprint = screen.getByTestId("blueprint-panel");
    // The blueprint that was built, read-only — not a draft that could be approved again.
    expect(blueprint).toHaveAttribute("data-title", "Approved");
    expect(blueprint).toHaveAttribute("data-editable", "false");
  });

  it("edits the blueprint only while it is waiting for approval", () => {
    const { unmount } = setup(detailIn("AWAITING_BLUEPRINT"));
    expect(screen.getByTestId("blueprint-panel")).toHaveAttribute("data-editable", "true");
    unmount();

    setup(detailIn("BUILDING"));
    fireEvent.click(tab("Blueprint"));
    expect(screen.getByTestId("blueprint-panel")).toHaveAttribute("data-editable", "false");
  });

  it("passes busy through so the tree can pause editing", () => {
    setup(detailIn("AWAITING_BLUEPRINT"), { isBusy: true });
    expect(screen.getByTestId("blueprint-panel")).toHaveAttribute("data-busy", "true");
  });
});

describe("CourseCopilotWorkPane — following the session", () => {
  it("moves with the status: interview, then blueprint, then build, then course", () => {
    const { update } = setup(detailIn("INTERVIEWING"));
    expect(shown()).toBe("brief");

    update({ detail: detailIn("AWAITING_BLUEPRINT") });
    expect(shown()).toBe("blueprint");

    update({ detail: detailIn("BUILDING") });
    expect(shown()).toBe("build");

    update({ detail: detailIn("EDITING") });
    expect(shown()).toBe("course");
  });

  it("switches to the blueprint when one arrives mid-turn, before the status has flipped", () => {
    const { update } = setup(detailIn("INTERVIEWING"));
    expect(shown()).toBe("brief");

    update({ liveBlueprint: response(1) });
    expect(shown()).toBe("blueprint");
    // Still read-only: the session is not yet waiting on an approval.
    expect(screen.getByTestId("blueprint-panel")).toHaveAttribute("data-editable", "false");
  });

  it("takes the view for a first blueprint even from a tab the trainer picked", () => {
    const { update } = setup(detailIn("INTERVIEWING"));
    fireEvent.click(tab("Brief"));
    update({ liveBlueprint: response(1) });
    expect(shown()).toBe("blueprint");
  });

  it("does not pull the trainer off a tab they picked in the same status", () => {
    const { update } = setup(detailIn("AWAITING_BLUEPRINT"), { liveBlueprint: response(2) });
    fireEvent.click(tab("Brief"));
    expect(shown()).toBe("brief");

    // The copilot rewrites the blueprint while they read the brief.
    update({ liveBlueprint: response(3, "Rewritten") });
    expect(shown()).toBe("brief");
    // The change is flagged on the tab instead of taking the view.
    expect(screen.getByRole("img", { name: "Updated" })).toBeInTheDocument();

    fireEvent.click(tab("Blueprint"));
    expect(screen.queryByRole("img", { name: "Updated" })).toBeNull();
    expect(screen.getByTestId("blueprint-panel")).toHaveAttribute("data-title", "Rewritten");
  });

  it("forgets a pick when the status changes", () => {
    const { update } = setup(detailIn("AWAITING_BLUEPRINT"));
    fireEvent.click(tab("Brief"));
    expect(shown()).toBe("brief");

    update({ detail: detailIn("BUILDING") });
    expect(shown()).toBe("build");
  });

  it("falls back to a tab that exists when the default has no data yet", () => {
    // EDITING normally opens on the course, but the outline has not loaded.
    const detail = detailIn("EDITING");
    detail.outline = null;
    setup(detail);
    expect(shown()).toBe("build");
  });
});

describe("CourseCopilotWorkPane — what each panel is handed", () => {
  it("prefers the live brief over the saved one", () => {
    const detail = makeDetail({ status: "INTERVIEWING", session: { brief: { seed: "saved" } } });
    const { update } = setup(detail);
    expect(screen.getByTestId("brief-panel")).toHaveAttribute("data-seed", "saved");

    update({ liveBrief: { seed: "live" } });
    expect(screen.getByTestId("brief-panel")).toHaveAttribute("data-seed", "live");
  });

  it("ignores a live blueprint older than the one the server now holds", () => {
    const detail = detailIn("AWAITING_BLUEPRINT");
    detail.session.blueprintVersion = 5;
    detail.session.blueprint = blueprintFor("Server copy");
    setup(detail, { liveBlueprint: response(3, "Stale live copy") });

    const panel = screen.getByTestId("blueprint-panel");
    expect(panel).toHaveAttribute("data-version", "5");
    expect(panel).toHaveAttribute("data-title", "Server copy");
  });

  it("uses the live blueprint when it is at least as new", () => {
    const detail = detailIn("AWAITING_BLUEPRINT");
    setup(detail, { liveBlueprint: response(2, "Live copy") });
    expect(screen.getByTestId("blueprint-panel")).toHaveAttribute("data-title", "Live copy");
  });

  it("holds Open in editor back during a build, with the reason, and not otherwise", () => {
    const { unmount } = setup(detailIn("BUILDING"));
    expect(screen.getByTestId("build-panel").getAttribute("data-editor-disabled")).toMatch(
      /Wait for the build to finish/,
    );
    unmount();

    setup(detailIn("EDITING"));
    expect(screen.getByTestId("course-panel")).toHaveAttribute("data-editor-disabled", "");
  });

  it("lets the trainer hand an unmet publish check to the copilot, only when it can act", () => {
    const { props, unmount } = setup(detailIn("EDITING"));
    expect(screen.getByTestId("course-panel")).toHaveAttribute("data-can-ask", "true");

    fireEvent.click(screen.getByRole("button", { name: "ask" }));
    expect(props.onSendMessage).toHaveBeenCalledWith(
      "Please fix this before we publish: Cover image (Needed)",
    );
    unmount();

    setup(detailIn("EDITING"), { isBusy: true });
    expect(screen.getByTestId("course-panel")).toHaveAttribute("data-can-ask", "false");
  });
});

describe("CourseCopilotWorkPane — tab strip", () => {
  it("is a tablist whose panel is labelled by the selected tab", () => {
    setup(detailIn("EDITING"));

    expect(screen.getByRole("tablist")).toBeInTheDocument();
    const panel = screen.getByRole("tabpanel");
    expect(panel).toHaveAttribute("aria-labelledby", tab("Course").id);
    expect(tab("Course")).toHaveAttribute("aria-controls", panel.id);
  });

  it("moves between enabled tabs with the arrow keys, skipping disabled ones", () => {
    setup(detailIn("EDITING"));
    fireEvent.click(tab("Brief"));

    fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowRight" });
    expect(shown()).toBe("blueprint");
    fireEvent.keyDown(screen.getByRole("tablist"), { key: "End" });
    expect(shown()).toBe("course");
    fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowRight" });
    expect(shown()).toBe("brief");
    fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowLeft" });
    expect(shown()).toBe("course");
  });

  it("does not let a click select a disabled tab", () => {
    setup(makeDetail({ status: "INTERVIEWING" }));
    fireEvent.click(tab("Course"));
    expect(shown()).toBe("brief");
  });
});

describe("CourseCopilotWorkPane — a panel that crashes", () => {
  it("is contained in its own boundary and the other tabs still work", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const detail = detailIn("EDITING");
    detail.session.brief = { seed: "boom" };
    setup(detail);

    fireEvent.click(tab("Brief"));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("tablist")).toBeInTheDocument();

    fireEvent.click(tab("Course"));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(shown()).toBe("course");
  });
});
