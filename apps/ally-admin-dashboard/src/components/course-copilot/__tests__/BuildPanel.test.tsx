import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CourseCopilotSessionDetail } from "@types";

// @constants reads off the @components barrel at module-eval time (see the Builder
// tests), so the barrel is stubbed rather than loaded for real.
vi.mock("@components", () => ({ cellTypes: {} }));

vi.mock("@components/action-confirmation-popup", () => ({
  ActionConfirmationPopup: ({ isOpen, title, description, primaryButton, secondaryButton }: any) =>
    isOpen ? (
      <div role="dialog">
        <p>{title}</p>
        <p>{description}</p>
        <button onClick={primaryButton.onClick}>{primaryButton.label}</button>
        <button onClick={secondaryButton.onClick}>{secondaryButton.label}</button>
      </div>
    ) : null,
}));

// Mirrors the real shape where it matters: the actionable notification takes its button as a
// PROP (Carbon throws on an interactive child of an InlineNotification, and a mock that
// accepted children happily is how that once shipped).
vi.mock("@ally-ui-mono/ui-shared", () => ({
  Button: ({ children, onClick, disabled }: any) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  ActionableNotification: ({ subtitle, actionButtonLabel, onActionButtonClick }: any) => (
    <div role="status">
      <p>{subtitle}</p>
      <button onClick={onActionButtonClick}>{actionButtonLabel}</button>
    </div>
  ),
  Tooltip: ({ children }: any) => <>{children}</>,
  RichTextRenderer: ({ content }: any) => <div>{content}</div>,
  ComposedModal: ({ open, children }: any) => (open ? <div role="dialog">{children}</div> : null),
  ModalBody: ({ children }: any) => <div>{children}</div>,
  NumberInput: ({ id, label, value, onChange }: any) => (
    <label htmlFor={id}>
      {label}
      <input
        id={id}
        value={value}
        onChange={event => onChange(event, { value: event.target.value })}
      />
    </label>
  ),
}));

// eslint-disable-next-line import/first
import { BuildPanel, BuildPanelProps, groupJobsBySection } from "../BuildPanel";
// eslint-disable-next-line import/first
import { budget, job, makeBlueprint, makeDetail, outline } from "./fixtures";

const NOW = new Date("2026-10-14T10:00:00Z");

const jobs = () => [
  job({
    id: "j1",
    kind: "article",
    blueprintItemId: "a",
    title: "What listening is",
    status: "done",
    attempts: 1,
    summary: "820 words, 2 checks",
    startedAt: "2026-10-14T09:58:00Z",
    finishedAt: "2026-10-14T09:58:45Z",
    costUsd: 0.12,
  }),
  job({
    id: "j2",
    kind: "quiz",
    blueprintItemId: "q",
    title: "Check your understanding",
    status: "running",
    attempts: 1,
    startedAt: "2026-10-14T09:59:30Z",
  }),
  job({
    id: "j3",
    kind: "roleplay_new",
    blueprintItemId: "r",
    title: "A hard first call",
    status: "failed",
    attempts: 2,
    error: "The persona didn't pass validation.",
    startedAt: "2026-10-14T09:58:10Z",
    finishedAt: "2026-10-14T09:59:10Z",
  }),
  job({ id: "j4", kind: "video", blueprintItemId: "v", title: "Watch a real call", status: "queued" }),
  job({
    id: "j5",
    kind: "course_meta",
    blueprintItemId: null,
    title: "Course details",
    status: "done",
    startedAt: "2026-10-14T09:58:00Z",
    finishedAt: "2026-10-14T09:58:20Z",
  }),
  job({
    id: "j6",
    kind: "cover_image",
    blueprintItemId: null,
    title: "Cover image",
    status: "skipped",
    skippedReason: "Image generation isn't configured.",
  }),
  job({
    id: "j7",
    kind: "article_image",
    blueprintItemId: "a",
    title: "Image for What listening is",
    status: "held",
  }),
];

const detailFor = (
  status: CourseCopilotSessionDetail["session"]["status"],
  overrides: Parameters<typeof makeDetail>[0]["detail"] = {},
) =>
  makeDetail({
    status,
    session: { approvedBlueprint: makeBlueprint(), blueprintVersion: 3 },
    detail: { jobs: jobs(), budget: budget({ ceilingUsd: 10, spentUsd: 3.5, remainingUsd: 6.5 }), ...overrides },
  });

const setup = (
  detail: CourseCopilotSessionDetail,
  overrides: Partial<BuildPanelProps> = {},
) => {
  const props: BuildPanelProps = {
    detail,
    onRetryJobs: vi.fn().mockResolvedValue(undefined),
    onCancelBuild: vi.fn().mockResolvedValue(undefined),
    onRaiseBudget: vi.fn().mockResolvedValue(true),
    onOpenEditor: vi.fn(),
    ...overrides,
  };
  return { ...render(<BuildPanel {...props} />), props };
};

const jobRow = (id: string) =>
  document.querySelector(`[data-job-id="${id}"]`) as HTMLElement;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("BuildPanel — job rows", () => {
  it("labels every status with the decided copy", () => {
    setup(detailFor("BUILDING"));

    expect(within(jobRow("j1")).getByText("Done")).toBeInTheDocument();
    expect(within(jobRow("j2")).getByText("Writing…")).toBeInTheDocument();
    expect(within(jobRow("j3")).getByText("Failed")).toBeInTheDocument();
    expect(within(jobRow("j4")).getByText("Waiting")).toBeInTheDocument();
    expect(within(jobRow("j6")).getByText("Skipped")).toBeInTheDocument();
    expect(within(jobRow("j7")).getByText("Paused")).toBeInTheDocument();
  });

  it("shows the summary of a done job, the error of a failed one and why one was skipped", () => {
    setup(detailFor("BUILDING"));

    expect(within(jobRow("j1")).getByText("820 words, 2 checks")).toBeInTheDocument();
    expect(within(jobRow("j3")).getByText("The persona didn't pass validation.")).toBeInTheDocument();
    expect(within(jobRow("j6")).getByText("Image generation isn't configured.")).toBeInTheDocument();
  });

  it("shows how long each job took, how long a running one has been going, attempts and cost", () => {
    setup(detailFor("BUILDING"));

    expect(within(jobRow("j1")).getByText(/45s/)).toBeInTheDocument();
    expect(within(jobRow("j1")).getByText(/\$0\.12/)).toBeInTheDocument();
    expect(within(jobRow("j2")).getByText(/30s/)).toBeInTheDocument();
    expect(within(jobRow("j3")).getByText(/1m 0s/)).toBeInTheDocument();
    expect(within(jobRow("j3")).getByText(/attempt 2/)).toBeInTheDocument();
  });

  it("groups jobs under their section, with course-wide jobs under Course, last", () => {
    setup(detailFor("BUILDING"));

    const groups = screen.getAllByRole("region").filter(region => region.querySelector("[data-job-id]"));
    expect(groups.map(group => group.getAttribute("aria-label"))).toEqual([
      "Foundations",
      "Practice",
      "Course",
    ]);
    expect(within(groups[0]).getAllByText(/What listening is|Check your understanding/).length).toBeGreaterThan(0);
    expect(groups[0].querySelectorAll("[data-job-id]")).toHaveLength(3);
    expect(groups[1].querySelectorAll("[data-job-id]")).toHaveLength(2);
    expect(groups[2].querySelectorAll("[data-job-id]")).toHaveLength(2);
  });

  it("falls back to a single Course group when the approved blueprint is missing", () => {
    const groups = groupJobsBySection(jobs(), null, "Course");
    expect(groups).toHaveLength(1);
    expect(groups[0].jobs).toHaveLength(7);
  });

  it("links a roleplay job to its simulation in a new tab", () => {
    setup(
      detailFor("BUILDING", {
        jobs: [
          job({
            id: "j9",
            kind: "roleplay_new",
            blueprintItemId: "r",
            title: "A hard first call",
            status: "done",
            scenarioId: 12,
          }),
        ],
      }),
    );

    const link = screen.getByRole("link", { name: /Open roleplay/ });
    expect(link).toHaveAttribute("href", "/create-simulation/edit/12");
    expect(link).toHaveAttribute("target", "_blank");
  });
});

describe("BuildPanel — progress and cost", () => {
  it("shows done of total, elapsed since the first job started, and spend against the ceiling", () => {
    setup(detailFor("BUILDING"));

    expect(screen.getByText("2 of 7 done")).toBeInTheDocument();
    // First job started 09:58:00; it is 10:00:00 and jobs are still live.
    expect(screen.getByText("2m 0s elapsed")).toBeInTheDocument();
    expect(screen.getByText("$3.50 of $10.00")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "2");
    expect(screen.getByText("1 failed · 1 skipped · 1 paused")).toBeInTheDocument();
  });

  it("says there is no ceiling rather than drawing a meter against zero", () => {
    setup(detailFor("BUILDING", { budget: budget({ ceilingUsd: 0, spentUsd: 3.5, remainingUsd: null }) }));

    expect(screen.getByText("$3.50 · no ceiling")).toBeInTheDocument();
    expect(screen.queryByRole("meter")).toBeNull();
  });

  it("stops the clock once every job has settled", () => {
    const settled = jobs().map(entry => ({
      ...entry,
      status: "done" as const,
      startedAt: entry.startedAt ?? "2026-10-14T09:58:00Z",
      finishedAt: "2026-10-14T09:59:00Z",
    }));
    setup(detailFor("EDITING", { jobs: settled }));

    expect(screen.getByText("1m 0s elapsed")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByText("1m 0s elapsed")).toBeInTheDocument();
    expect(screen.getByText("Build summary")).toBeInTheDocument();
  });

  it("titles a live build 'Building your course'", () => {
    setup(detailFor("BUILDING"));
    expect(screen.getByRole("heading", { name: "Building your course" })).toBeInTheDocument();
  });

  it("copes with a jobs list that is not an array", () => {
    setup(detailFor("BUILDING", { jobs: "nope" as never }));
    expect(screen.getByText("No build jobs yet.")).toBeInTheDocument();
  });
});

describe("BuildPanel — retry", () => {
  it("offers Retry on failed and skipped jobs only, for that one job", async () => {
    const { props } = setup(detailFor("BUILDING"));

    expect(within(jobRow("j1")).queryByRole("button", { name: "Retry" })).toBeNull();
    expect(within(jobRow("j4")).queryByRole("button", { name: "Retry" })).toBeNull();
    expect(within(jobRow("j2")).queryByRole("button", { name: "Retry" })).toBeNull();

    await act(async () => {
      fireEvent.click(within(jobRow("j3")).getByRole("button", { name: "Retry" }));
    });
    expect(props.onRetryJobs).toHaveBeenLastCalledWith(["j3"]);

    await act(async () => {
      fireEvent.click(within(jobRow("j6")).getByRole("button", { name: "Retry" }));
    });
    expect(props.onRetryJobs).toHaveBeenLastCalledWith(["j6"]);
  });

  it("'Retry all failed' retries without naming jobs, so the server picks every failed and skipped one", async () => {
    const { props } = setup(detailFor("BUILDING"));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retry all failed" }));
    });
    expect(props.onRetryJobs).toHaveBeenCalledTimes(1);
    expect(props.onRetryJobs).toHaveBeenCalledWith();
  });

  it("labels the bulk button honestly when everything retryable was only skipped", () => {
    setup(detailFor("EDITING", { jobs: [jobs()[5]] }));
    expect(screen.getByRole("button", { name: "Retry skipped" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry all failed" })).toBeNull();
  });

  it("shows no bulk retry when nothing failed", () => {
    setup(detailFor("BUILDING", { jobs: [jobs()[0], jobs()[1]] }));
    expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull();
  });
});

describe("BuildPanel — cancel", () => {
  it("asks before stopping, in the decided words, and only stops on confirm", async () => {
    const { props } = setup(detailFor("BUILDING"));

    fireEvent.click(screen.getByRole("button", { name: "Cancel build" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Stop the build?");
    expect(dialog).toHaveTextContent(
      "Items already written stay in the course; waiting items are skipped.",
    );
    expect(props.onCancelBuild).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Keep building" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(props.onCancelBuild).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Cancel build" }));
    await act(async () => {
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Stop the build" }));
    });
    expect(props.onCancelBuild).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("has nothing to cancel once the build is not running", () => {
    setup(detailFor("EDITING"));
    expect(screen.queryByRole("button", { name: "Cancel build" })).toBeNull();
  });
});

describe("BuildPanel — budget hold", () => {
  const held = () =>
    detailFor("BUILDING", { budget: budget({ ceilingUsd: 10, spentUsd: 10, remainingUsd: 0, held: true }) });

  it("shows the decided hold copy with the figures", () => {
    setup(held());

    expect(
      screen.getByText(
        "Paused at the budget ceiling — $10.00 of $10.00 spent. Raise the ceiling to continue, or stop here and keep what's built.",
      ),
    ).toBeInTheDocument();
  });

  it("has no hold banner while under the ceiling", () => {
    setup(detailFor("BUILDING"));
    expect(screen.queryByText(/Paused at the budget ceiling/)).toBeNull();
  });

  it("raises the ceiling from the banner, opening on a figure clear of the spend", async () => {
    const { props } = setup(held());

    fireEvent.click(screen.getByRole("button", { name: "Raise budget" }));
    const dialog = screen.getByRole("dialog");
    // Seeded from the spend ($10), not the ceiling that just stopped the build.
    expect(within(dialog).getByLabelText("New ceiling (USD)")).toHaveValue("20");

    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Raise and continue" }));
    });
    expect(props.onRaiseBudget).toHaveBeenCalledWith(20);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps the dialog open when the server refuses the new ceiling", async () => {
    const { props } = setup(held(), { onRaiseBudget: vi.fn().mockResolvedValue(false) });

    fireEvent.click(screen.getByRole("button", { name: "Raise budget" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Raise and continue" }));
    });
    expect(props.onRaiseBudget).toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("will not submit a ceiling at or below what has been spent", () => {
    const { props } = setup(held());

    fireEvent.click(screen.getByRole("button", { name: "Raise budget" }));
    fireEvent.change(screen.getByLabelText("New ceiling (USD)"), { target: { value: "10" } });
    expect(screen.getByRole("button", { name: "Raise and continue" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("New ceiling (USD)"), { target: { value: "0" } });
    expect(screen.getByRole("button", { name: "Raise and continue" })).toBeEnabled();
    expect(props.onRaiseBudget).not.toHaveBeenCalled();
  });
});

describe("BuildPanel — a failed build", () => {
  it("shows the decided banner with a Retry that resumes the whole build", async () => {
    const { props } = setup(detailFor("BUILD_FAILED"));

    expect(
      screen.getByText(
        "The build stopped responding. Retry picks up where it left off — nothing already written is lost.",
      ),
    ).toBeInTheDocument();

    const banner = screen.getByRole("status");
    await act(async () => {
      fireEvent.click(within(banner).getByRole("button", { name: "Retry" }));
    });
    expect(props.onRetryJobs).toHaveBeenCalledWith();
  });

  it("does not offer to cancel a build that is not running", () => {
    setup(detailFor("BUILD_FAILED"));
    expect(screen.queryByRole("button", { name: "Cancel build" })).toBeNull();
  });
});

describe("BuildPanel — the outline filling in below", () => {
  it("shows the course so far, compact, with Open in editor held back during a build", () => {
    const course = outline({
      sections: [
        {
          id: "s1",
          order: 1,
          title: "Foundations",
          items: [
            {
              id: "a",
              type: "ARTICLE",
              order: 1,
              title: "What listening is",
              size: "820 words, 2 checks",
              preview: {
                type: "ARTICLE",
                excerpt: "Listening is more than hearing.",
                wordCount: 820,
                questionCount: 2,
                resourceCount: 0,
                imageUrls: [],
              },
            },
          ],
        },
      ],
    });
    setup(detailFor("BUILDING", { outline: course }), {
      openEditorDisabledReason: "Wait for the build to finish — the copilot overwrites edits made during the build.",
    });

    const section = screen.getByRole("region", { name: "Course so far" });
    expect(within(section).getByText("820 words, 2 checks")).toBeInTheDocument();
    // Compact: a line per item, not the excerpt.
    expect(within(section).queryByText("Listening is more than hearing.")).toBeNull();
    expect(within(section).getByRole("button", { name: "Open in editor" })).toBeDisabled();
  });

  it("says the outline fills in as items are written when there is none yet", () => {
    setup(detailFor("BUILDING", { outline: null }));
    expect(screen.getByText("The outline fills in as items are written.")).toBeInTheDocument();
  });
});
