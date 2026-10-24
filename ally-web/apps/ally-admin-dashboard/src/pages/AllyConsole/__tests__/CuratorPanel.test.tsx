import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

const h = vi.hoisted(() => ({
  lessons: vi.fn(),
  lessonsArgs: vi.fn(),
  playbook: vi.fn(),
  audit: vi.fn(),
  run: vi.fn(),
  approve: vi.fn(),
  reject: vi.fn(),
  retire: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  userId: { current: 7 as number | undefined },
  access: { current: { canEdit: true } as Record<string, boolean> },
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
vi.mock("@hooks", () => ({ useAllyGuideAccess: () => h.access.current }));
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGetAllyGuideLessonsQuery: (arg: unknown) => {
    h.lessonsArgs(arg);
    return h.lessons();
  },
  useGetAllyGuidePlaybookQuery: () => h.playbook(),
  useGetAllyGuideLearningAuditQuery: () => h.audit(),
  useRunAllyGuideCuratorMutation: () => [h.run, { isLoading: false }],
  useApproveAllyGuideLessonMutation: () => [h.approve],
  useRejectAllyGuideLessonMutation: () => [h.reject],
  useRetireAllyGuideLessonMutation: () => [h.retire],
}));

// eslint-disable-next-line import/first
import { CuratorPanel } from "../CuratorPanel";

const ok = (data: unknown) => ({
  data,
  currentData: data,
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
});

const lesson = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  kind: "lesson",
  scope: "platform",
  tenantId: null,
  trackId: null,
  status: "quarantined",
  text: `Lesson ${id}`,
  change: null,
  rationale: "Learners asked twice",
  evidence: {},
  blockReason: null,
  releaseId: null,
  authorKind: "curator",
  decidedBy: null,
  decidedAt: null,
  createdAt: "2026-10-22T10:00:00.000Z",
  ...overrides,
});

const PLAYBOOK = {
  releaseId: "rel-9",
  version: 9,
  caps: {
    platform: { used: 3, max: 5 },
    org: { max: 3, used: { "t-1": 1, "t-2": 2 } },
    course: { max: 2, used: {} },
  },
  lessons: [
    { id: "lesson-live", scope: "platform", text: "Name the feeling first" },
    { id: "snapshot-1", scope: "org", text: "Older snapshot lesson" },
  ],
};

const AUDIT = [
  {
    id: "a-1",
    lessonId: "l-1",
    releaseId: null,
    action: "approved",
    actorKind: "human",
    actorUserId: 7,
    detail: { notes: "fine", tenantCount: 2, nested: { skip: true } },
    createdAt: "2026-10-22T11:00:00.000Z",
  },
  {
    id: "a-2",
    lessonId: null,
    releaseId: null,
    action: "curator_run",
    actorKind: "curator",
    actorUserId: null,
    detail: null,
    createdAt: "2026-10-22T03:00:00.000Z",
  },
  {
    id: "a-3",
    lessonId: null,
    releaseId: null,
    action: "stage_changed",
    actorKind: "human",
    actorUserId: 12,
    detail: null,
    createdAt: "2026-10-21T03:00:00.000Z",
  },
];

describe("CuratorPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.userId.current = 7;
    h.access.current = { canEdit: true };
    h.lessons.mockReturnValue(ok([lesson("l-1"), lesson("l-2", { scope: "org" })]));
    h.playbook.mockReturnValue(ok(PLAYBOOK));
    h.audit.mockReturnValue(ok(AUDIT));
    for (const call of [h.run, h.approve, h.reject, h.retire]) {
      call.mockReturnValue({ unwrap: () => Promise.resolve({}) });
    }
  });

  it("opens on what needs a person, and asks for the newest 200", () => {
    render(<CuratorPanel />);

    expect(screen.getByLabelText("Which changes to show")).toHaveValue("quarantined");
    expect(h.lessonsArgs).toHaveBeenLastCalledWith({
      status: "quarantined",
      scope: undefined,
      limit: 200,
    });
    expect(screen.getAllByTestId("curator-lesson-row")).toHaveLength(2);
    expect(screen.getAllByTestId("lesson-text")[0]).toHaveTextContent("Lesson l-1");
  });

  it("filters by status and scope, and sends 'all' as no status", () => {
    render(<CuratorPanel />);

    fireEvent.change(screen.getByLabelText("Which changes to show"), { target: { value: "all" } });
    fireEvent.change(screen.getByLabelText("Scope"), { target: { value: "course" } });

    expect(h.lessonsArgs).toHaveBeenLastCalledWith({
      status: undefined,
      scope: "course",
      limit: 200,
    });
  });

  it("says nothing needs a person when the queue is empty", () => {
    h.lessons.mockReturnValue(ok([]));
    render(<CuratorPanel />);

    expect(screen.getByTestId("ally-empty")).toHaveTextContent("Nothing needs a person");
  });

  it("shows the curator's reasoning, and why a guardrail stopped a change", () => {
    h.lessons.mockReturnValue(
      ok([lesson("l-3", { status: "blocked", blockReason: "answer_leak" })]),
    );
    render(<CuratorPanel />);

    const row = screen.getByTestId("curator-lesson-row");
    expect(row).toHaveTextContent("Why: Learners asked twice");
    expect(row).toHaveTextContent("Stopped by: answer leak");
    expect(row).toHaveTextContent("Blocked by a guardrail");
  });

  it("offers approve and reject on a quarantined change, and nothing on a rejected one", () => {
    h.lessons.mockReturnValue(
      ok([
        lesson("l-1"),
        lesson("l-4", { status: "rejected", decidedBy: 7, decidedAt: "2026-10-22T12:00:00.000Z" }),
      ]),
    );
    render(<CuratorPanel />);

    const [quarantined, rejected] = screen.getAllByTestId("curator-lesson-row");
    expect(within(quarantined).getByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(within(quarantined).getByRole("button", { name: "Reject" })).toBeInTheDocument();
    expect(within(rejected).queryByRole("button")).not.toBeInTheDocument();
    expect(rejected).toHaveTextContent("Decided by you");
  });

  it("approves with the note, on that lesson, after a confirmation", async () => {
    render(<CuratorPanel />);

    fireEvent.click(
      within(screen.getAllByTestId("curator-lesson-row")[0]).getByRole("button", {
        name: "Approve",
      }),
    );
    expect(screen.getByRole("dialog", { name: "Approve this change?" })).toHaveTextContent(
      "Lesson l-1",
    );
    fireEvent.change(screen.getByLabelText("Notes (optional)"), { target: { value: "ok to go" } });
    fireEvent.click(screen.getByRole("button", { name: "Approve change" }));

    await waitFor(() => expect(h.approve).toHaveBeenCalledWith({ id: "l-1", notes: "ok to go" }));
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("Approved."));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("rejects through its own call, and says so when it fails", async () => {
    h.reject.mockReturnValue({
      unwrap: () => Promise.reject({ data: { message: "Already decided." } }),
    });
    render(<CuratorPanel />);

    fireEvent.click(
      within(screen.getAllByTestId("curator-lesson-row")[1]).getByRole("button", {
        name: "Reject",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Reject change" }));

    await waitFor(() => expect(h.reject).toHaveBeenCalledWith({ id: "l-2", notes: "" }));
    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(h.approve).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("hides every action without the edit grant", () => {
    h.access.current = { canEdit: false };
    render(<CuratorPanel />);

    expect(screen.queryByRole("button", { name: "Run the curator now…" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retire" })).not.toBeInTheDocument();
    expect(screen.getByTestId("playbook-table")).toBeInTheDocument();
  });

  it("starts the curator only after a confirmation that says it spends budget", async () => {
    render(<CuratorPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Run the curator now…" }));
    expect(screen.getByRole("dialog", { name: "Run the curator now" })).toHaveTextContent(
      "spends model budget",
    );
    expect(h.run).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Run curator" }));

    await waitFor(() => expect(h.run).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith(
        "Started. Proposed changes appear below when it finishes.",
      ),
    );
  });

  it("shows the playbook's release and each scope's fullest cap", () => {
    render(<CuratorPanel />);

    expect(screen.getByTestId("playbook-release")).toHaveTextContent("live release v9");
    const caps = screen.getByTestId("playbook-caps");
    expect(caps).toHaveTextContent("Everyone: 3 of 5");
    expect(caps).toHaveTextContent("One organisation, fullest: 2 of 3");
    expect(caps).toHaveTextContent("One course, fullest: 0 of 2");
  });

  it("lets a live lesson be retired, but not a snapshot row that has no lesson to retire", async () => {
    render(<CuratorPanel />);

    const [live, snapshot] = screen.getAllByTestId("playbook-row");
    expect(within(snapshot).queryByRole("button")).not.toBeInTheDocument();
    fireEvent.click(within(live).getByRole("button", { name: "Retire" }));
    fireEvent.click(screen.getByRole("button", { name: "Retire lesson" }));

    await waitFor(() => expect(h.retire).toHaveBeenCalledWith({ id: "lesson-live", notes: "" }));
  });

  it("says when the live release carries no lessons, or none is live", () => {
    h.playbook.mockReturnValue(ok({ releaseId: null, version: null, lessons: [] }));
    render(<CuratorPanel />);

    expect(screen.getByTestId("playbook-release")).toHaveTextContent("no live release");
    expect(screen.getByTestId("playbook-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("playbook-caps")).not.toBeInTheDocument();
  });

  it("lists the learning audit with who did it: you, another user's id, or the system", () => {
    render(<CuratorPanel />);

    const [approved, curatorRun, stage] = screen.getAllByTestId("learning-audit-row");
    expect(approved).toHaveTextContent("Change approved");
    expect(approved).toHaveTextContent("you");
    expect(approved).toHaveTextContent("notes: fine · tenant count: 2");
    expect(approved).not.toHaveTextContent("skip");
    expect(curatorRun).toHaveTextContent("Curator ran");
    expect(curatorRun).toHaveTextContent("The curator");
    expect(stage).toHaveTextContent("user 12");
  });

  it("says when the audit is empty", () => {
    h.audit.mockReturnValue(ok([]));
    render(<CuratorPanel />);

    expect(screen.getByTestId("audit-empty")).toBeInTheDocument();
  });

  it("fails each section on its own, with a retry", () => {
    const refetch = vi.fn();
    h.playbook.mockReturnValue({ isLoading: false, isError: true, error: {}, refetch });
    render(<CuratorPanel />);

    expect(screen.getByTestId("curator-lessons")).toBeInTheDocument();
    expect(screen.getByTestId("learning-audit")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refetch).toHaveBeenCalled();
  });
});
