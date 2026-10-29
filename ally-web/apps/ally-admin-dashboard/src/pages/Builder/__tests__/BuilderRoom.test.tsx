import { act, fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BuilderDecision, BuilderNow, BuilderNowSession } from "@types";

const { toastFn } = vi.hoisted(() => ({
  toastFn: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: toastFn }));

const env = vi.hoisted(() => ({
  layout: { layout: "desktop", finePointer: true } as {
    layout: "phone" | "tablet" | "desktop";
    finePointer: boolean;
  },
}));
// Not importActual: the real module opens a socket through the app's store.
vi.mock("../room/useRoomEnvironment", async () => {
  const { useState } = await import("react");
  return {
    useDraft: () => useState(""),
    useRoomLayout: () => env.layout,
    useBuilderLive: () => ({ paused: false, refreshedAt: 0 }),
    useOnline: () => true,
  };
});

// `src/utils` and `src/hooks` pull in the real store; stubbed as the sibling page tests do.
vi.mock("@hooks", () => ({}));
vi.mock("@utils", () => ({}));
vi.mock("@components", () => ({ cellTypes: {} }));
vi.mock("../../../hooks/useAllySocket", () => ({
  AllySocketStatus: { CONNECTED: "CONNECTED" },
  useAllySocket: () => ({ emit: vi.fn() }),
}));

const NOW = Date.now();
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

const decision = (id: string, over: Partial<BuilderDecision> = {}): BuilderDecision =>
  ({
    id,
    kind: "question",
    category: "what",
    sessionId: "s-rate",
    sessionTitle: "Rate the debrief",
    sessionStatus: "INTERVIEWING",
    createdByName: null,
    repos: [],
    prompt: `Prompt ${id}`,
    rationale: null,
    questionType: null,
    context: [],
    blocked: "The PRD.",
    selection: "single",
    options: [
      { id: "a", label: `Option A ${id}`, recommended: true },
      { id: "b", label: `Option B ${id}` },
    ],
    allowCustom: true,
    allowNone: false,
    minSelections: null,
    customPlaceholder: null,
    waitingSince: ago(12),
    pullRequestUrl: null,
    ...over,
  }) as BuilderDecision;

const session = (id: string, over: Partial<BuilderNowSession> = {}): BuilderNowSession =>
  ({
    id,
    title: `Session ${id}`,
    code: `OPP-${id}`,
    opportunityId: null,
    status: "INTERVIEWING",
    currentStage: null,
    waitingOn: "you",
    nowLine: "Interview",
    waitingSince: ago(12),
    stuckSince: null,
    pendingCount: 1,
    pendingKinds: ["question"],
    putBackEligible: false,
    runSequence: null,
    pullRequests: [],
    createdByName: null,
    startedAt: ago(60),
    updatedAt: ago(1),
    ...over,
  }) as BuilderNowSession;

const mocks = vi.hoisted(() => ({
  nowData: null as unknown as BuilderNow,
  answerMock: vi.fn(),
  undoMock: vi.fn(),
}));
const { answerMock, undoMock } = mocks;

vi.mock("@api", () => {
  const mutation = (fn: any) => () => [fn, { isLoading: false }];
  return {
    useGetBuilderNowQuery: () => ({
      data: mocks.nowData,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    }),
    useGetBuilderUpNextQuery: () => ({
      data: {
        items: [
          {
            id: "o1",
            code: "OPP-0582",
            title: "Course sign-off",
            description: "",
            queueRank: 1,
            voterCount: 5,
            effort: "m",
            productGoal: null,
            goalsHelped: 2,
            goalsAssessed: 10,
            successMetric: null,
            assessment: null,
          },
        ],
        inProgress: 2,
        limit: 3,
      },
      refetch: vi.fn(),
    }),
    useAnswerBuilderDecisionMutation: mutation((...args: any[]) => mocks.answerMock(...args)),
    useUndoBuilderDecisionMutation: mutation((...args: any[]) => mocks.undoMock(...args)),
    useStartBuilderUpNextMutation: mutation(vi.fn()),
    usePutBackBuilderSessionMutation: mutation(vi.fn()),
    useAskBuilderSessionMutation: mutation(vi.fn()),
    useTellBuilderSessionMutation: mutation(vi.fn()),
    useAskBuilderAllWorkMutation: mutation(vi.fn()),
    useGetBuilderThreadQuery: () => ({ data: [] }),
    useGetBuilderRulesQuery: () => ({ data: [], isLoading: false, isError: false }),
    useGetBuilderRuleProposalsQuery: () => ({ data: [] }),
    useSetBuilderRuleActiveMutation: mutation(vi.fn()),
    useCreateBuilderRuleMutation: mutation(vi.fn()),
    useDismissBuilderRuleProposalMutation: mutation(vi.fn()),
    useDraftBuilderRuleMutation: mutation(vi.fn()),
    usePreviewBuilderRuleMutation: mutation(vi.fn()),
    useGetBuilderHistoryQuery: () => ({
      data: { entries: [], nextBefore: null },
      isFetching: false,
    }),
  };
});

/* eslint-disable import/first, import/order -- must follow the vi.mock calls. */
import { BuilderRoom } from "../BuilderRoom";

const renderRoom = (path = "/builder") =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/builder" element={<BuilderRoom />} />
      </Routes>
    </MemoryRouter>,
  );

describe("BuilderRoom", () => {
  beforeEach(() => {
    env.layout = { layout: "desktop", finePointer: true };
    mocks.nowData = {
      sessions: [
        session("rate"),
        session("build", { waitingOn: "builder", nowLine: "Writing code", pendingKinds: [] }),
      ],
      decisions: [decision("q1", { sessionId: "rate" })],
      inProgress: 2,
      limit: 3,
    };
    answerMock.mockReset().mockReturnValue({
      unwrap: () =>
        Promise.resolve({
          ok: true,
          outcome: "pending",
          undoableUntil: new Date(Date.now() + 8_000).toISOString(),
          historyId: "h1",
        }),
    });
    undoMock.mockReset().mockReturnValue({ unwrap: () => Promise.resolve({ ok: true }) });
    toastFn.mockReset();
  });

  it("answers the question in three seconds: a summary sentence, then the decision as the hero", () => {
    renderRoom();
    expect(screen.getByText("1 decision needs you")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Prompt q1" })).toBeInTheDocument();
    expect(screen.getByText("Writing code")).toBeInTheDocument();
  });

  it("sends with the layout and time-to-decide, offers Undo, and Z takes it back", async () => {
    renderRoom();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Option B q1/ }));
    });
    expect(answerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "q1",
        selectedOptionIds: ["b"],
        client: "desktop",
        msToDecide: expect.any(Number),
      }),
    );
    expect(toastFn).toHaveBeenCalledWith(
      expect.stringContaining("Option B q1"),
      expect.objectContaining({ action: expect.objectContaining({ label: "Undo" }) }),
    );
    await act(async () => {
      fireEvent.keyDown(window, { key: "z" });
    });
    expect(undoMock).toHaveBeenCalledWith("q1");
  });

  it("takes an answer back even when Z is pressed before the server has replied", async () => {
    let resolve: (value: unknown) => void = () => undefined;
    answerMock.mockReturnValue({ unwrap: () => new Promise(r => (resolve = r)) });
    renderRoom();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Option B q1/ }));
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: "z" });
    });
    // The card is back at once; the undo goes out as soon as the answer lands.
    expect(screen.getByRole("heading", { name: "Prompt q1" })).toBeInTheDocument();
    expect(undoMock).not.toHaveBeenCalled();
    await act(async () => {
      resolve({
        ok: true,
        outcome: "pending",
        undoableUntil: new Date(Date.now() + 8_000).toISOString(),
        historyId: "h1",
      });
    });
    expect(undoMock).toHaveBeenCalledWith("q1");
  });

  it("never moves the card you're reading when a decision arrives", () => {
    const { rerender } = renderRoom();
    mocks.nowData = {
      ...mocks.nowData,
      decisions: [
        decision("budget", { kind: "budget", sessionId: "build" }),
        ...mocks.nowData.decisions,
      ],
    };
    rerender(
      <MemoryRouter initialEntries={["/builder"]}>
        <Routes>
          <Route path="/builder" element={<BuilderRoom />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: "Prompt q1" })).toBeInTheDocument();
    expect(screen.getAllByText("1 new").length).toBeGreaterThan(0);
  });

  it("opens straight onto a deep-linked decision", () => {
    mocks.nowData = {
      ...mocks.nowData,
      decisions: [
        ...mocks.nowData.decisions,
        decision("q2", { sessionId: "rate", waitingSince: ago(1) }),
      ],
    };
    renderRoom("/builder?decision=q2");
    expect(screen.getByRole("heading", { name: "Prompt q2" })).toBeInTheDocument();
  });

  it("opens a session in the decision's column from the list", () => {
    renderRoom();
    fireEvent.click(
      within(document.querySelector("[data-room-list]") as HTMLElement).getByText("Session build"),
    );
    expect(screen.getByRole("heading", { name: "Session build" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Decisions/ })).toBeInTheDocument();
  });

  it("on a phone: a bottom action bar with Ask or tell, the list behind a strip, no key hints", () => {
    env.layout = { layout: "phone", finePointer: false };
    renderRoom();
    expect(screen.getByRole("button", { name: "Ask or tell" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Needs you 1 · Working 1 · Up next/ }),
    ).toBeInTheDocument();
    expect(document.querySelector("[data-room-list]")).toBeNull();
    expect(document.querySelector("kbd")).toBeNull();
  });
});
