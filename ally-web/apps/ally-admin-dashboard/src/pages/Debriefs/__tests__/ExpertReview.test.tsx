import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

const h = vi.hoisted(() => ({
  queue: vi.fn(),
  review: vi.fn(),
  mine: vi.fn(),
  verdict: vi.fn(),
  add: vi.fn(),
  edit: vi.fn(),
  remove: vi.fn(),
  status: vi.fn(),
  still: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock(
  "@ally-ui-mono/ui-shared",
  async () =>
    (await import("../../../components/ally-guide/__tests__/uiSharedFakes")).uiSharedFakes,
);
vi.mock("sonner", () => ({
  toast: { error: (m: string) => h.toastError(m), success: (m: string) => h.toastSuccess(m) },
}));
vi.mock("../RunPanel", () => ({
  RunPanel: ({ runId }: { runId: string | null }) =>
    runId ? <div data-testid="run-panel">{runId}</div> : null,
  SessionLogLink: () => <a href="#log">log</a>,
}));
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGetExpertReviewQueueQuery: (a: unknown) => h.queue(a),
  useGetExpertReviewQuery: (id: string) => h.review(id),
  useGetMyExpertCommentsQuery: () => h.mine(),
  useSetExpertVerdictMutation: () => [h.verdict, { isLoading: false }],
  useAddExpertCommentMutation: () => [h.add, { isLoading: false }],
  useEditExpertCommentMutation: () => [h.edit, { isLoading: false }],
  useDeleteExpertCommentMutation: () => [h.remove, { isLoading: false }],
  useSetExpertCommentStatusMutation: () => [h.status, { isLoading: false }],
  useMarkStillHappeningMutation: () => [h.still, { isLoading: false }],
}));

// eslint-disable-next-line import/first
import { visibleDebriefTabs } from "../DebriefConsole";
// eslint-disable-next-line import/first
import { ExpertReviewScreen } from "../ExpertReviewScreen";
// eslint-disable-next-line import/first
import { ExpertReviewTab } from "../ExpertReviewTab";
// eslint-disable-next-line import/first
import { segmentText, selectionToAnchor } from "../expertReviewSelection";

const ok = (data: unknown) => ({
  data,
  isLoading: false,
  isError: false,
  error: undefined,
  refetch: vi.fn(),
});
const resolves = (v: unknown = {}) => ({ unwrap: () => Promise.resolve(v) });

const RUN_ID = "aaaaaaaa-0000-4000-8000-000000000001";

const QUEUE = {
  items: [
    {
      runId: RUN_ID,
      sessionId: "s1",
      status: "published",
      mode: "live",
      language: "hi",
      sessionType: "standard",
      tenantId: "t1",
      tenantName: "Sangath",
      createdAt: "2026-11-10T09:00:00Z",
      reasons: ["risk_cue", "sample"],
      commentCount: 2,
      reviewCount: 1,
      myVerdict: null,
      judgeOverall: null,
    },
  ],
  filters: {
    tenants: [{ id: "t1", name: "Sangath" }],
    languages: ["hi"],
    sessionTypes: ["standard"],
  },
};

const comment = (over: Record<string, unknown> = {}) => ({
  id: "c1",
  runId: RUN_ID,
  parentId: null,
  anchorKind: "transcript",
  turnIndex: 2,
  section: null,
  spanStart: 2,
  spanEnd: 14,
  quotedText: "cannot sleep",
  body: "The debrief never comes back to this.",
  tag: "missed_moment",
  status: "open",
  reviewer: { id: 7, name: "Tanuja" },
  mine: true,
  createdAt: "2026-11-10T10:00:00Z",
  updatedAt: "2026-11-10T10:00:00Z",
  resolvedAt: null,
  idea: { id: "i1", title: "Ask the Writer to cover sleep", status: "proposed" },
  repeatOf: null,
  ...over,
});

const detail = (over: Record<string, unknown> = {}) => ({
  run: {
    id: RUN_ID,
    sessionId: "s1",
    status: "published",
    mode: "live",
    language: "hi",
    sessionType: "standard",
    tenantName: "Sangath",
    createdAt: "2026-11-10T09:00:00Z",
    hasRiskCue: true,
    learnerDistress: false,
    releaseVersion: 3,
  },
  transcript: [
    { turnIndex: 1, speaker: "learner", text: "What brings you here?", gap: false, riskCue: null },
    {
      turnIndex: 2,
      speaker: "client",
      text: "I cannot sleep before exams.",
      gap: false,
      riskCue: { category: "sleep", learnerResponse: "explored" },
    },
  ],
  cards: {
    opening: "You stayed with the client.",
    important_moment: null,
    what_worked: [
      {
        skill: "open questions",
        turn_index: 1,
        quote: "What brings you here?",
        lead: "Your opening let them lead.",
        body: "It invited them in.",
      },
    ],
    work_on_this: [],
    reflective_question: "What would you ask next?",
  },
  corrections: [],
  flags: [],
  comments: [comment()],
  myReview: null,
  otherReviews: { count: 1, verdicts: null },
  judge: null,
  evaluator: null,
  hardFailCodes: ["fabricated_quote", "missed_risk_cue"],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  h.queue.mockReturnValue(ok(QUEUE));
  h.mine.mockReturnValue(ok({ items: [] }));
  h.review.mockReturnValue(ok(detail()));
  h.verdict.mockReturnValue(resolves());
  h.add.mockReturnValue(resolves());
  h.status.mockReturnValue(resolves());
  h.still.mockReturnValue(resolves());
});

describe("expert review selection helpers", () => {
  it("highlights each comment's span, earlier comments keeping an overlap", () => {
    expect(
      segmentText("I cannot sleep before exams.", [
        { id: "a", spanStart: 2, spanEnd: 8, status: "open" },
        { id: "b", spanStart: 6, spanEnd: 14, status: "resolved" },
      ]),
    ).toEqual([
      { text: "I ", commentId: null, resolved: false },
      { text: "cannot", commentId: "a", resolved: false },
      { text: " sleep", commentId: "b", resolved: true },
      { text: " before exams.", commentId: null, resolved: false },
    ]);
  });

  it("turns a selection inside one line into offsets in that line, trimmed", () => {
    document.body.innerHTML = `<p><span data-anchor="turn:2">I <mark>cannot</mark> sleep before exams.</span></p>`;
    const line = document.querySelector("[data-anchor]") as HTMLElement;
    const range = document.createRange();
    range.setStart(line.firstChild as Text, 1); // the space before "cannot"
    const after = line.childNodes[2] as Text; // " sleep before exams."
    range.setEnd(after, 6);
    const selection = window.getSelection() as Selection;
    selection.removeAllRanges();
    selection.addRange(range);
    expect(selectionToAnchor(selection)).toEqual({
      anchorKind: "transcript",
      turnIndex: 2,
      spanStart: 2,
      spanEnd: 14,
      quotedText: "cannot sleep",
    });
  });

  it("ignores a selection that crosses two lines", () => {
    document.body.innerHTML = `<span data-anchor="turn:1">one</span><span data-anchor="card:opening">two</span>`;
    const [a, b] = Array.from(document.querySelectorAll("[data-anchor]"));
    const range = document.createRange();
    range.setStart(a.firstChild as Text, 0);
    range.setEnd(b.firstChild as Text, 2);
    const selection = window.getSelection() as Selection;
    selection.removeAllRanges();
    selection.addRange(range);
    expect(selectionToAnchor(selection)).toBeNull();
  });
});

describe("Debrief Console tabs", () => {
  it("shows Expert review only to holders of Review debriefs (expert)", () => {
    expect(visibleDebriefTabs([])).not.toContain("expert-review");
    expect(visibleDebriefTabs(["review:admin:debriefs"])).toContain("expert-review");
  });
});

describe("ExpertReviewTab", () => {
  it("lists debriefs with why they're here, hiding the judge score until a verdict", () => {
    render(
      <MemoryRouter>
        <ExpertReviewTab />
      </MemoryRouter>,
    );
    const row = screen.getByTestId("expert-queue-row");
    expect(within(row).getByText("Risk cue")).toBeTruthy();
    expect(within(row).getByText("Random sample")).toBeTruthy();
    expect(within(row).getByText("After your verdict")).toBeTruthy();
    expect(within(row).getByText("Standard")).toBeTruthy();
  });

  it("filters by organisation", () => {
    render(
      <MemoryRouter>
        <ExpertReviewTab />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText("Organisation"), { target: { value: "Sangath" } });
    expect(h.queue).toHaveBeenLastCalledWith({ tenantId: "t1" });
  });

  it("filters in one row of house dropdowns, languages by name, with a toggle and Clear filters", () => {
    render(
      <MemoryRouter>
        <ExpertReviewTab />
      </MemoryRouter>,
    );
    const row = screen.getByTestId("expert-filters");
    const language = within(row).getByLabelText("Language");
    expect(
      within(language)
        .getAllByRole("option")
        .map(o => o.textContent),
    ).toEqual(["All languages", "Hindi"]);
    expect(within(row).getByLabelText("Why it's here")).toHaveDisplayValue("All reasons");
    expect(screen.queryByRole("button", { name: "Clear filters" })).toBeNull();
    fireEvent.change(language, { target: { value: "Hindi" } });
    fireEvent.click(within(row).getByRole("switch", { name: "Show debriefs I've reviewed" }));
    expect(h.queue).toHaveBeenLastCalledWith({ language: "hi", includeReviewed: true });
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(h.queue).toHaveBeenLastCalledWith({});
    expect(screen.getByTestId("expert-queue-row")).toHaveTextContent("Hindi");
  });

  it("says so when nothing matches", () => {
    h.queue.mockReturnValue(ok({ ...QUEUE, items: [] }));
    render(
      <MemoryRouter>
        <ExpertReviewTab />
      </MemoryRouter>,
    );
    expect(screen.getByText("Nothing waiting for review")).toBeTruthy();
  });

  it("opens the review screen from the list", () => {
    render(
      <MemoryRouter>
        <ExpertReviewTab />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(screen.getByTestId("expert-review-screen")).toBeTruthy();
    expect(h.review).toHaveBeenCalledWith(RUN_ID);
  });
});

describe("ExpertReviewScreen", () => {
  const renderScreen = () =>
    render(
      <MemoryRouter>
        <ExpertReviewScreen runId={RUN_ID} onBack={vi.fn()} />
      </MemoryRouter>,
    );

  it("shows the transcript with the risk cue, the cards, and each comment with what happened to it", () => {
    renderScreen();
    expect(screen.getAllByTestId("expert-turn")).toHaveLength(2);
    expect(screen.getByText("Risk cue: sleep")).toBeTruthy();
    expect(screen.getByText("Your opening let them lead.")).toBeTruthy();
    expect(screen.getAllByTestId("comment-highlight")[0].textContent).toBe("cannot sleep");
    expect(screen.getByTestId("comment-idea").textContent).toContain("Being tried");
  });

  it("names the language and a learner flag's card section in words", () => {
    h.review.mockReturnValue(
      ok(
        detail({
          flags: [
            {
              id: "f1",
              section: "work_on_this[1]",
              reason: "wrong",
              note: null,
              status: "published",
              resolutionNote: null,
              createdAt: "2026-11-10T10:00:00Z",
            },
          ],
        }),
      ),
    );
    renderScreen();
    expect(screen.getByTestId("expert-review-screen")).toHaveTextContent("· Hindi");
    expect(screen.getByTestId("expert-flags")).toHaveTextContent("Work on this, point 2");
    expect(screen.getByTestId("expert-flags")).not.toHaveTextContent("work_on_this");
  });

  it("keeps the scores hidden until a verdict, and a hard fail forces Needs work", async () => {
    renderScreen();
    expect(screen.queryByTestId("expert-scores")).toBeNull();
    fireEvent.click(screen.getByLabelText(/ignores how the learner responded/));
    fireEvent.click(screen.getByRole("button", { name: "Save verdict" }));
    await waitFor(() =>
      expect(h.verdict).toHaveBeenCalledWith({
        runId: RUN_ID,
        verdict: "needs_work",
        hardFails: ["missed_risk_cue"],
      }),
    );
  });

  it("shows the judge and the others' verdicts once a verdict is given", () => {
    h.review.mockReturnValue(
      ok(
        detail({
          myReview: { verdict: "good", hardFails: [], updatedAt: "2026-11-10T11:00:00Z" },
          judge: { overall: 6.5, hardFails: [] },
          evaluator: { overall: 8.5, hardFails: [] },
          otherReviews: { count: 1, verdicts: [{ verdict: "needs_work", hardFails: ["tone"] }] },
        }),
      ),
    );
    renderScreen();
    const scores = screen.getByTestId("expert-scores");
    expect(scores.textContent).toContain("Independent judge: 6.5");
    expect(scores.textContent).toContain("Needs work, 1 hard fail");
  });

  it("selecting words in a turn opens a comment on exactly those words", async () => {
    renderScreen();
    const line = screen
      .getAllByTestId("expert-turn")[0]
      .querySelector("[data-anchor]") as HTMLElement;
    const range = document.createRange();
    range.setStart(line.firstChild as Text, 0);
    range.setEnd(line.firstChild as Text, 4);
    const selection = window.getSelection() as Selection;
    selection.removeAllRanges();
    selection.addRange(range);
    fireEvent.mouseUp(line);
    const composer = screen.getByTestId("expert-composer");
    expect(composer.textContent).toContain("“What”");
    fireEvent.change(within(composer).getByPlaceholderText(/What should change/), {
      target: { value: "Good open question" },
    });
    fireEvent.change(within(composer).getByLabelText("Tag (optional)"), {
      target: { value: "good_keep_this" },
    });
    fireEvent.click(within(composer).getByRole("button", { name: "Comment" }));
    await waitFor(() =>
      expect(h.add).toHaveBeenCalledWith({
        runId: RUN_ID,
        comment: {
          anchorKind: "transcript",
          turnIndex: 1,
          spanStart: 0,
          spanEnd: 4,
          quotedText: "What",
          body: "Good open question",
          tag: "good_keep_this",
        },
      }),
    );
  });

  it("a general comment has no anchor, and a thread can be resolved", async () => {
    renderScreen();
    fireEvent.click(screen.getByRole("button", { name: "Comment on the whole debrief" }));
    expect(screen.getByTestId("expert-composer").textContent).toContain(
      "Comment on the whole debrief",
    );
    fireEvent.click(screen.getByRole("button", { name: "Resolve" }));
    await waitFor(() => expect(h.status).toHaveBeenCalledWith({ id: "c1", action: "resolve" }));
  });

  it("marks an earlier comment as still happening on this debrief", async () => {
    h.mine.mockReturnValue(
      ok({
        items: [
          { ...comment({ id: "old", runId: "other-run" }), language: "hi", sessionType: null },
        ],
      }),
    );
    renderScreen();
    fireEvent.click(screen.getByRole("button", { name: "Still happening here" }));
    await waitFor(() =>
      expect(h.still).toHaveBeenCalledWith({
        id: "old",
        runId: RUN_ID,
        comment: { anchorKind: "debrief", body: "Still happening here", tag: "missed_moment" },
      }),
    );
  });

  it("tells a failed load apart from an empty one", () => {
    h.review.mockReturnValue({ ...ok(undefined), isError: true, error: { status: 500 } });
    renderScreen();
    expect(screen.getByTestId("ally-load-failed")).toBeTruthy();
  });
});
