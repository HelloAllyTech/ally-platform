import "@constants";
import React from "react";

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { en } from "@constants";
import { store } from "@store";

import type { RoadmapDraftDetail } from "../../../types/roadmapV2Flow";

const mockTurn = vi.fn();
const mockReopen = vi.fn();
const mockSubmit = vi.fn();
const mockSuggestTitle = vi.fn();
const mockPatch = vi.fn();
const mockCreate = vi.fn();
let mockDraft: RoadmapDraftDetail | undefined;

const unwrapOf = (fn: ReturnType<typeof vi.fn>) =>
  vi.fn((arg: unknown) => ({ unwrap: () => Promise.resolve(fn(arg)) }));

vi.mock("../../../api/roadmapV2Flow", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGetRoadmapDraftQuery: () => ({
    data: mockDraft,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useRoadmapDraftTurnMutation: () => [unwrapOf(mockTurn)],
  useReopenRoadmapDraftCheckMutation: () => [unwrapOf(mockReopen)],
  useSubmitRoadmapDraftMutation: () => [unwrapOf(mockSubmit)],
  usePatchRoadmapDraftMutation: () => [unwrapOf(mockPatch)],
  useCreateRoadmapDraftMutation: () => [unwrapOf(mockCreate)],
  useDiscardRoadmapDraftMutation: () => [unwrapOf(vi.fn())],
  useRestoreRoadmapDraftMutation: () => [unwrapOf(vi.fn())],
  useSelfCheckRoadmapDraftMutation: () => [unwrapOf(vi.fn())],
  useAddRoadmapDraftToMutation: () => [unwrapOf(vi.fn())],
  useGetRoadmapDraftSimilarQuery: () => ({ data: undefined }),
  useRoadmapDictateMutation: () => [unwrapOf(vi.fn())],
}));
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGetRoadmapProductGoalsQuery: () => ({
    data: [{ id: "g1", name: "Learner return", position: 1 }],
  }),
  useSuggestRoadmapTitleMutation: () => [unwrapOf(mockSuggestTitle)],
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), custom: vi.fn(), dismiss: vi.fn() },
}));

import { setReduceMotionSwitch, __resetReduceMotionForTests } from "../../../motion/roadmapMotion";
import { DraftView } from "../drafts/DraftView";
import { __resetDeviceStoreForTests } from "../utils/deviceStore";

const checks = (met: number): RoadmapDraftDetail["checks"] =>
  (["who_it_affects", "pain_or_gain", "clear_why", "goal_before_solution", "outcome"] as const).map(
    (id, i) => ({
      id,
      label: `Label ${id}`,
      hint: `Hint ${id}`,
      met: i < met,
      source: i < met ? "agent" : null,
      evidence: i < met ? { quote: "new learners", from: "text" } : null,
      note: null,
      reopened: false,
    }),
  );

const draft = (met: number, overrides: Partial<RoadmapDraftDetail> = {}): RoadmapDraftDetail => ({
  code: "OPP-0042",
  sessionId: "s1",
  shownStage: "draft",
  statusParts: { stage: "draft", checksMet: met, checksTotal: 5 },
  text: "Streak for new learners",
  title: "Streak for new learners",
  goal: null,
  suggestedGoal: { id: "g1", name: "Learner return" },
  checks: checks(met),
  checksMet: met,
  checksTotal: 5,
  canSubmit: met === 5,
  selfChecked: false,
  selfCheckOffered: false,
  checkedAt: null,
  conversation: [],
  version: 3,
  savedAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  archivedAt: null,
  archiveAt: null,
  purgeAt: null,
  spend: { spentUsd: 0, ideaCapUsd: 1, wrapUp: false },
  ...overrides,
});

const renderDraft = (breakpoint: "desktop" | "phone" = "desktop") =>
  render(
    <Provider store={store}>
      <MemoryRouter>
        <DraftView code="OPP-0042" breakpoint={breakpoint} />
      </MemoryRouter>
    </Provider>,
  );

beforeEach(() => {
  [mockTurn, mockReopen, mockSubmit, mockPatch, mockCreate, mockSuggestTitle].forEach(fn =>
    fn.mockReset(),
  );
  mockSuggestTitle.mockReturnValue({ title: "A suggested title" });
  mockPatch.mockImplementation(() => ({
    code: "OPP-0042",
    title: "t",
    version: 4,
    savedAt: new Date().toISOString(),
    checksMet: 3,
    checksTotal: 5,
  }));
});
afterEach(() => {
  __resetDeviceStoreForTests();
  __resetReduceMotionForTests();
  window.localStorage.clear();
});

describe("the draft page (§4.2)", () => {
  it("says it's private and keeps Submit locked below 5 of 5", async () => {
    mockDraft = draft(3);
    renderDraft();
    expect(screen.getByText(en.roadmapV2.draft.privateBanner)).toBeInTheDocument();
    expect(screen.getByText(en.roadmapV2.draft.checksCountLong(3, 5))).toBeInTheDocument();
    const panel = () =>
      within(screen.getByRole("region", { name: en.roadmapV2.draft.checksTitle }));
    const submit = panel().getByRole("button", { name: en.roadmapV2.draft.submit });
    expect(submit).toBeDisabled();
    expect(screen.getByText(en.roadmapV2.draft.submitLocked(3, 5))).toBeInTheDocument();
    // Each met check quotes its evidence.
    expect(screen.getAllByText(en.roadmapV2.draft.evidence("new learners")).length).toBe(3);
  });

  it("at 5 of 5, Submit asks one confirm naming who will see it", async () => {
    mockDraft = draft(5);
    mockSubmit.mockReturnValue({ item: { code: "OPP-0042" }, firstSubmit: true });
    renderDraft();
    const submit = within(
      screen.getByRole("region", { name: en.roadmapV2.draft.checksTitle }),
    ).getByRole("button", { name: en.roadmapV2.draft.submit });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    expect(await screen.findByText(en.roadmapV2.draft.submitConfirmBody)).toBeInTheDocument();
  });

  it("the Submit dialog suggests a title, requires one, and sends it", async () => {
    mockDraft = draft(5);
    mockSubmit.mockReturnValue({ item: { code: "OPP-0042" }, firstSubmit: true });
    renderDraft();
    fireEvent.click(
      within(screen.getByRole("region", { name: en.roadmapV2.draft.checksTitle })).getByRole(
        "button",
        { name: en.roadmapV2.draft.submit },
      ),
    );
    const input = await screen.findByLabelText(en.roadmapV2.draft.titleLabel);
    await waitFor(() => expect(input).toHaveValue("A suggested title"));

    fireEvent.change(input, { target: { value: "" } });
    const confirm = within(
      screen.getByRole("dialog", { name: en.roadmapV2.draft.submitConfirmTitle }),
    ).getByRole("button", {
      name: en.roadmapV2.draft.submitConfirm,
    });
    expect(confirm).toBeDisabled();
    expect(screen.getByText(en.roadmapV2.draft.titleRequired)).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "  My own title  " } });
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(mockSubmit).toHaveBeenCalledWith(expect.objectContaining({ title: "My own title" })),
    );
  });

  it("Not quite reopens the check, then asks the agent again", async () => {
    mockDraft = draft(2);
    mockReopen.mockReturnValue(draft(1));
    mockTurn.mockReturnValue(draft(1));
    renderDraft();
    fireEvent.click(screen.getAllByRole("button", { name: en.roadmapV2.draft.notQuite })[0]);
    await waitFor(() =>
      expect(mockReopen).toHaveBeenCalledWith({ code: "OPP-0042", checkId: "who_it_affects" }),
    );
    await waitFor(() => expect(mockTurn).toHaveBeenCalledWith({ code: "OPP-0042" }));
  });

  it("Check my idea asks the agent with no answer; a 503 says so with Retry", async () => {
    mockDraft = draft(0);
    mockTurn.mockImplementation(() => {
      throw { status: 503, data: { code: "assistant_unavailable", failures: 1 } };
    });
    renderDraft();
    fireEvent.click(screen.getAllByRole("button", { name: en.roadmapV2.draft.checkMyIdea })[0]);
    expect(await screen.findByText(en.roadmapV2.draft.assistantUnavailable)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: en.roadmapV2.draft.retry })).toBeInTheDocument();
  });

  it("never offers Fill it in yourself, even after failed turns: drafts finish in the interview", async () => {
    mockDraft = draft(0);
    mockTurn.mockImplementation(() => {
      throw { status: 503, data: { code: "assistant_unavailable" } };
    });
    renderDraft();
    const button = () => screen.getAllByRole("button", { name: en.roadmapV2.draft.checkMyIdea })[0];
    fireEvent.click(button());
    await screen.findByText(en.roadmapV2.draft.assistantUnavailable);
    fireEvent.click(button());
    await screen.findByText(en.roadmapV2.draft.assistantUnavailable);
    expect(screen.queryByText(en.roadmapV2.draft.selfCheckOffer)).not.toBeInTheDocument();
  });

  it("autosaves typing to the server with the version it was written on", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockDraft = draft(3);
    renderDraft();
    const box = screen.getByLabelText(en.roadmapV2.draft.textLabel);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    fireEvent.change(box, { target: { value: "Streak for new learners in week one" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    await waitFor(() =>
      expect(mockPatch).toHaveBeenCalledWith({
        code: "OPP-0042",
        patch: { text: "Streak for new learners in week one", goalId: null, baseVersion: 3 },
      }),
    );
    vi.useRealTimers();
  });

  it("phone: a 3 of 5 pill opens the checks, and Submit sits in the sticky bar at 5 of 5", () => {
    mockDraft = draft(5);
    renderDraft("phone");
    expect(
      screen.getByRole("button", {
        name: `${en.roadmapV2.draft.showChecks}: ${en.roadmapV2.draft.checksCountLong(5, 5)}`,
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: en.roadmapV2.draft.submit })[0]).toBeEnabled();
  });

  it("reduced motion lands on the same final state: the same checks drawn, the same count", () => {
    mockDraft = draft(4);
    const { container, unmount } = renderDraft();
    const full = container.querySelectorAll("[data-met]").length;
    unmount();
    setReduceMotionSwitch(true);
    const reduced = renderDraft();
    expect(reduced.container.querySelectorAll("[data-met]").length).toBe(full);
    expect(screen.getByText(en.roadmapV2.draft.checksCountLong(4, 5))).toBeInTheDocument();
  });

  describe("what will be submitted (audit rec. 6)", () => {
    const proposal = { title: "Week-one streaks", statement: "New learners keep a streak." };
    const confirmSubmit = async () => {
      fireEvent.click(
        within(screen.getByRole("region", { name: en.roadmapV2.draft.checksTitle })).getByRole(
          "button",
          { name: en.roadmapV2.draft.submit },
        ),
      );
      await screen.findByText(en.roadmapV2.draft.submitConfirmBody);
      const buttons = screen.getAllByRole("button", { name: en.roadmapV2.draft.submitConfirm });
      fireEvent.click(buttons[buttons.length - 1]);
    };

    it("offers the agent's version first, editable, and files the edit under the agent's title", async () => {
      mockDraft = draft(5, { proposal, textMax: 1000 });
      mockSubmit.mockReturnValue({ item: { code: "OPP-0042" }, firstSubmit: false });
      renderDraft();
      const words = en.roadmapV2.draft.submitChoice;
      expect(screen.getByRole("radio", { name: new RegExp(words.useThis) })).toBeChecked();
      fireEvent.change(screen.getByLabelText(words.statementLabel), {
        target: { value: "New learners keep a streak for a week." },
      });
      await confirmSubmit();
      // The dialog's required Title box (#342) starts from the agent's own title.
      await waitFor(() =>
        expect(mockSubmit).toHaveBeenCalledWith(
          expect.objectContaining({
            code: "OPP-0042",
            title: "Week-one streaks",
            choice: { use: "agent", statement: "New learners keep a streak for a week." },
          }),
        ),
      );
    });

    it("Use mine files the author's words", async () => {
      mockDraft = draft(5, { proposal });
      mockSubmit.mockReturnValue({ item: { code: "OPP-0042" }, firstSubmit: false });
      renderDraft();
      fireEvent.click(
        screen.getByRole("radio", { name: new RegExp(en.roadmapV2.draft.submitChoice.useMine) }),
      );
      await confirmSubmit();
      await waitFor(() =>
        expect(mockSubmit).toHaveBeenCalledWith(
          expect.objectContaining({ choice: { use: "mine" } }),
        ),
      );
    });

    it("with no agent statement it says so and sends no choice, as before", async () => {
      mockDraft = draft(5);
      mockSubmit.mockReturnValue({ item: { code: "OPP-0042" }, firstSubmit: false });
      renderDraft();
      expect(screen.getByText(en.roadmapV2.draft.submitChoice.noStatement)).toBeInTheDocument();
      await confirmSubmit();
      await waitFor(() => expect(mockSubmit).toHaveBeenCalled());
      expect(mockSubmit.mock.calls[0][0]).not.toHaveProperty("choice");
    });

    it("shows the one limit as a counter on the text box", () => {
      mockDraft = draft(3, { textMax: 1000 });
      renderDraft();
      expect(
        screen.getByText(en.roadmapV2.draft.textCount("Streak for new learners".length, 1000)),
      ).toBeInTheDocument();
    });

    it("what the idea agent found opens on demand", () => {
      mockDraft = draft(3, {
        brief: {
          strategicFit: [],
          reach: { howMany: null, howOften: null },
          evidence: [{ source: "analytics", claim: "Few return in week two", ref: null }],
          successMetric: null,
          assumptions: ["Streaks motivate"],
          alternativesDropped: [],
          assessment: { rating: "promising", summary: "Worth testing", openRecommendations: [] },
        },
      });
      renderDraft();
      const findings = en.roadmapV2.draft.findings;
      expect(screen.queryByText("Few return in week two")).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: new RegExp(findings.title) }));
      expect(screen.getByText("Few return in week two")).toBeInTheDocument();
      expect(screen.getByText(findings.assessment)).toBeInTheDocument();
    });
  });
});
