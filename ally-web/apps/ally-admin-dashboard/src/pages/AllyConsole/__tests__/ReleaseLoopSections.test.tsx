import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

import type { AllyGuideRelease } from "@types";

const h = vi.hoisted(() => ({
  trail: vi.fn(),
  reports: vi.fn(),
  reportsOptions: vi.fn(),
  report: vi.fn(),
  start: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  userId: { current: 7 as number | undefined },
}));

vi.mock(
  "@ally-ui-mono/ui-shared",
  async () =>
    (await import("../../../components/ally-guide/__tests__/uiSharedFakes")).uiSharedFakes,
);
vi.mock("sonner", () => ({
  toast: { error: (m: string) => h.toastError(m), success: (m: string) => h.toastSuccess(m) },
}));
vi.mock("react-redux", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useSelector: (select: (state: unknown) => unknown) =>
    select({ user: { user: { id: h.userId.current } } }),
}));
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGetAllyGuideReleaseTrailQuery: (id: string) => h.trail(id),
  useGetAllyGuideShadowReportsQuery: (arg: unknown, options: unknown) => {
    h.reportsOptions(arg, options);
    return h.reports();
  },
  useGetAllyGuideShadowReportQuery: (id: string) => h.report(id),
  useStartAllyGuideShadowMutation: () => [h.start, { isLoading: false }],
}));

// eslint-disable-next-line import/first
import { ReleaseTrailSection, ShadowSection } from "../ReleaseLoopSections";

const ok = (data: unknown) => ({ data, isLoading: false, isError: false, refetch: vi.fn() });

const release = (overrides: Record<string, unknown> = {}) =>
  ({ id: "rel-4", version: 4, status: "canary", ...overrides }) as unknown as AllyGuideRelease;

const trailRow = (overrides: Record<string, unknown> = {}) => ({
  at: "2026-10-22T10:00:00.000Z",
  source: "release",
  action: "gate_passed",
  actorKind: "system",
  actorUserId: null,
  detail: null,
  ...overrides,
});

const TRAIL = {
  release: {
    id: "rel-4",
    version: 4,
    status: "canary",
    authorKind: "curator",
    evalRunId: null,
    shadowReportId: null,
    changeSet: { lessons: [{ id: "l-1", text: "Name the feeling" }], policy: { warmth: 3 } },
  },
  trail: [
    trailRow(),
    trailRow({
      source: "learning",
      action: "approved",
      actorKind: "human",
      actorUserId: 7,
      detail: { notes: "fine" },
    }),
    trailRow({ source: "learning", action: "stage_changed", actorKind: "human", actorUserId: 12 }),
    trailRow({ action: "curator_proposed", actorKind: "curator" }),
  ],
};

const shadow = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  releaseId: "rel-4",
  baselineReleaseId: "rel-3",
  status: "passed",
  turnCount: 120,
  summary: {},
  costUsd: "1.50",
  triggeredBy: 7,
  completedAt: "2026-10-22T10:30:00.000Z",
  createdAt: "2026-10-22T10:00:00.000Z",
  ...overrides,
});

describe("ReleaseTrailSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.userId.current = 7;
    h.trail.mockReturnValue(ok(TRAIL));
  });

  it("reads the trail of its own release", () => {
    render(<ReleaseTrailSection releaseId="rel-4" />);

    expect(h.trail).toHaveBeenCalledWith("rel-4");
  });

  it("lists every step, naming learning-loop actions by their audit words and others by their id", () => {
    render(<ReleaseTrailSection releaseId="rel-4" />);

    const rows = screen.getAllByTestId("trail-row");
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveTextContent("Gate passed");
    expect(rows[0]).toHaveTextContent("Release");
    expect(rows[1]).toHaveTextContent("Change approved");
    expect(rows[1]).toHaveTextContent("Learning loop");
    expect(rows[3]).toHaveTextContent("Curator proposed");
  });

  it("says who: the system, you, another user's id", () => {
    render(<ReleaseTrailSection releaseId="rel-4" />);

    const rows = screen.getAllByTestId("trail-row");
    expect(rows[0]).toHaveTextContent("The system");
    expect(rows[1]).toHaveTextContent("you");
    expect(rows[2]).toHaveTextContent("user 12");
    expect(rows[3]).toHaveTextContent("The curator");
  });

  it("summarises a row's detail without nested values", () => {
    render(<ReleaseTrailSection releaseId="rel-4" />);

    expect(screen.getAllByTestId("trail-row")[1]).toHaveTextContent("notes: fine");
  });

  it("shows what the curator changed when the release carries a change set", () => {
    render(<ReleaseTrailSection releaseId="rel-4" />);

    const changes = screen.getByTestId("release-change-set");
    expect(changes).toHaveTextContent("lessons.0.text");
    expect(changes).toHaveTextContent("Name the feeling");
    expect(changes).toHaveTextContent("policy.warmth");
  });

  it("leaves the change set out when there is none, and says an empty trail is empty", () => {
    h.trail.mockReturnValue(ok({ release: { ...TRAIL.release, changeSet: null }, trail: [] }));
    render(<ReleaseTrailSection releaseId="rel-4" />);

    expect(screen.queryByTestId("release-change-set")).not.toBeInTheDocument();
    expect(screen.getByTestId("trail-empty")).toBeInTheDocument();
  });

  it("fails alone, with a retry, and loads quietly", () => {
    const refetch = vi.fn();
    h.trail.mockReturnValue({ isLoading: false, isError: true, error: {}, refetch });
    const { unmount } = render(<ReleaseTrailSection releaseId="rel-4" />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refetch).toHaveBeenCalled();
    unmount();

    h.trail.mockReturnValue({ isLoading: true });
    render(<ReleaseTrailSection releaseId="rel-4" />);
    expect(screen.getByTestId("ally-loading")).toBeInTheDocument();
  });
});

describe("ShadowSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.reports.mockReturnValue(ok([shadow("s-1"), shadow("s-2", { status: "failed" })]));
    h.report.mockReturnValue(ok(shadow("s-1")));
    h.start.mockReturnValue({ unwrap: () => Promise.resolve({}) });
  });

  it("asks for the reports of its own release", () => {
    render(<ShadowSection release={release()} canEdit />);

    expect(h.reportsOptions).toHaveBeenLastCalledWith(
      { releaseId: "rel-4" },
      { pollingInterval: 0 },
    );
  });

  it("polls while a shadow is running", () => {
    h.reports.mockReturnValue(ok([shadow("s-3", { status: "running" })]));
    render(<ShadowSection release={release()} canEdit />);

    expect(h.reportsOptions).toHaveBeenLastCalledWith(
      { releaseId: "rel-4" },
      { pollingInterval: 5000 },
    );
  });

  it("lists each report with its result, turns and cost", () => {
    render(<ShadowSection release={release()} canEdit />);

    const [first, second] = screen.getAllByTestId("shadow-report-row");
    expect(first).toHaveTextContent("Passed");
    expect(first).toHaveTextContent("120");
    expect(first).toHaveTextContent("$1.50");
    expect(second).toHaveTextContent("Failed");
  });

  it("says when the release has not been shadowed", () => {
    h.reports.mockReturnValue(ok([]));
    render(<ShadowSection release={release()} canEdit />);

    expect(screen.getByTestId("shadow-empty")).toBeInTheDocument();
  });

  it("starts a shadow only after a confirmation that says it costs money, naming the version", async () => {
    render(<ShadowSection release={release()} canEdit />);

    fireEvent.click(screen.getByRole("button", { name: "Run shadow…" }));
    expect(screen.getByRole("dialog", { name: "Shadow v4?" })).toHaveTextContent("costs money");
    expect(h.start).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Start shadow" }));

    await waitFor(() => expect(h.start).toHaveBeenCalledWith("rel-4"));
    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith(
        "Started. The report appears below when it finishes.",
      ),
    );
  });

  it("says so, and keeps the dialog, when starting fails", async () => {
    h.start.mockReturnValue({
      unwrap: () => Promise.reject({ data: { message: "Already running." } }),
    });
    render(<ShadowSection release={release()} canEdit />);

    fireEvent.click(screen.getByRole("button", { name: "Run shadow…" }));
    fireEvent.click(screen.getByRole("button", { name: "Start shadow" }));

    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("does not offer a shadow without the edit grant, or for the live release, and says why", () => {
    const { unmount } = render(<ShadowSection release={release()} canEdit={false} />);
    expect(screen.queryByRole("button", { name: "Run shadow…" })).not.toBeInTheDocument();
    unmount();

    render(<ShadowSection release={release({ status: "ga" })} canEdit />);
    expect(screen.queryByRole("button", { name: "Run shadow…" })).not.toBeInTheDocument();
    expect(screen.getByTestId("release-shadow")).toHaveTextContent(
      "not offered for the live release",
    );
  });

  it("opens a report to the candidate beside live, and closes it again", () => {
    h.report.mockReturnValue(
      ok(
        shadow("s-1", {
          summary: {
            reasons: ["Candidate passed 2 points more checks"],
            ga: { passRate: 0.9, safetyFailures: 1, meanWords: 61.4 },
            candidate: { passRate: 0.92, safetyFailures: 0, meanWords: null },
            newSafetyFailures: 1,
            crisisDisagreements: 0,
            errors: 3,
            byCheck: { no_prompt_leak: [2, 0], warmth: [1, 4] },
          },
        }),
      ),
    );
    render(<ShadowSection release={release()} canEdit />);

    const open = screen.getAllByRole("button", { name: /^Open the shadow report from/ })[0];
    fireEvent.click(open);

    expect(h.report).toHaveBeenCalledWith("s-1");
    expect(screen.getByTestId("shadow-reasons")).toHaveTextContent(
      "Candidate passed 2 points more",
    );
    expect(screen.getByTestId("shadow-pass-rate")).toHaveTextContent("90.0%");
    expect(screen.getByTestId("shadow-pass-rate")).toHaveTextContent("92.0%");
    expect(screen.getByTestId("shadow-safety")).toHaveTextContent("1");
    expect(screen.getByTestId("shadow-sides")).toHaveTextContent("61");
    expect(screen.getByTestId("shadow-sides")).toHaveTextContent("—");
    expect(screen.getByTestId("shadow-new-safety")).toHaveTextContent(
      "1 turn failed a safety check that the live release passed.",
    );
    expect(screen.getByTestId("shadow-crisis")).toHaveTextContent("never disagreed");
    expect(screen.getByTestId("shadow-report")).toHaveTextContent(
      "3 turns errored and were left out.",
    );
    const byCheck = screen.getByTestId("shadow-by-check");
    expect(within(byCheck).getByText("warmth").closest("tr")).toHaveTextContent("14");

    fireEvent.click(open);
    expect(screen.queryByTestId("shadow-report")).not.toBeInTheDocument();
  });

  it("shows a failed shadow as failed, with the reason, and no comparison", () => {
    h.report.mockReturnValue(
      ok(shadow("s-1", { status: "error", summary: { error: "model down" } })),
    );
    render(<ShadowSection release={release()} canEdit />);

    fireEvent.click(screen.getAllByRole("button", { name: /^Open the shadow report from/ })[0]);

    expect(screen.getByTestId("shadow-report")).toHaveTextContent(
      "The shadow itself failed: model down",
    );
    expect(screen.queryByTestId("shadow-sides")).not.toBeInTheDocument();
  });
});
