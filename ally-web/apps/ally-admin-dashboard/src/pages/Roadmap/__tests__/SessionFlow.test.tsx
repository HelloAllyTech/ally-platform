import "@constants";
import React from "react";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { en } from "@constants";
import { store } from "@store";
import type { BuilderQuestionEvent, RoadmapItemDetail } from "@types";

import type { RoadmapSessionAnswers } from "../../../types/roadmapV2Flow";

const mockAnswer = vi.fn();
const mockComment = vi.fn();
const mockChoose = vi.fn();
let mockAnswers: RoadmapSessionAnswers = { questions: [], comments: [] };
const unwrapOf = (fn: ReturnType<typeof vi.fn>) =>
  vi.fn((arg: unknown) => ({ unwrap: () => Promise.resolve(fn(arg)) }));

vi.mock("../../../api/roadmapV2Flow", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGetRoadmapSessionAnswersQuery: () => ({ data: mockAnswers, refetch: vi.fn() }),
  usePostRoadmapAnswerMutation: () => [unwrapOf(mockAnswer)],
  usePostRoadmapCommentMutation: () => [unwrapOf(mockComment)],
  useChooseRoadmapAnswerMutation: () => [unwrapOf(mockChoose)],
  useRoadmapDictateMutation: () => [unwrapOf(vi.fn())],
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), custom: vi.fn() } }));

import { setReduceMotionSwitch, __resetReduceMotionForTests } from "../../../motion/roadmapMotion";
import { CommentBox } from "../session/CommentBox";
import { publishRoadmapPresence } from "../session/presenceContext";
import { QuestionCard } from "../session/QuestionCard";
import { useSessionAnswers } from "../session/useSessionAnswers";
import { __resetDeviceStoreForTests } from "../utils/deviceStore";

const item = (
  can: RoadmapItemDetail["can"] = { answer: true, comment: true },
): RoadmapItemDetail => ({
  id: "u-388",
  code: "OPP-388",
  title: "Streak on start screen",
  shownStage: "planning",
  statusParts: {
    stage: "planning",
    step: "prd",
    leadUserId: 2,
    prdPercent: 40,
    openQuestions: 1,
    designAwaitingApproval: false,
  },
  author: { id: 1, name: "Ravi", role: "idea" },
  lead: { id: 2, name: "Priya", role: "builder" },
  votes: 3,
  votedByMe: false,
  starred: false,
  unread: false,
  updatedAt: "2026-11-10T00:00:00Z",
  stageSince: "2026-11-06T00:00:00Z",
  summary: {},
  sessionId: "sess-1",
  runs: [],
  prs: [],
  releases: [],
  people: [
    { id: 1, name: "Ravi", role: "idea", relation: "author" },
    { id: 2, name: "Priya", role: "builder", relation: "lead" },
  ],
  can,
  watchLevel: "all",
});

const question: BuilderQuestionEvent = {
  id: "q1",
  prompt: "Which learners see the streak first?",
  kind: "singleSelect",
  options: [
    { id: "o1", label: "Everyone" },
    { id: "o2", label: "Only new learners" },
  ],
};

const post = (
  id: string,
  by: { id: number; name: string; relation: "author" | "builder" | "lead" },
  optionId: string,
  label: string,
) => ({
  id,
  seq: 1,
  kind: "answer" as const,
  questionId: "q1",
  text: label,
  optionIds: [optionId],
  by: { id: by.id, name: by.name, role: "idea" as const, relation: by.relation },
  at: "2026-11-07T00:00:00Z",
  idempotencyKey: `key-${id}`,
});

const Card: React.FC<{ detail: RoadmapItemDetail; breakpointWidth?: number }> = ({ detail }) => {
  const session = useSessionAnswers(detail);
  return (
    <ol>
      <QuestionCard
        question={question}
        item={detail}
        session={session}
        agentName="Plan agent"
        latest
      />
    </ol>
  );
};

const wrap = (ui: React.ReactElement) =>
  render(
    <Provider store={store}>
      <MemoryRouter>{ui}</MemoryRouter>
    </Provider>,
  );

beforeEach(() => {
  [mockAnswer, mockComment, mockChoose].forEach(fn => fn.mockReset());
  mockAnswers = { questions: [], comments: [] };
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1400 });
});
afterEach(() => {
  __resetDeviceStoreForTests();
  __resetReduceMotionForTests();
  publishRoadmapPresence(null);
  window.localStorage.clear();
});

describe("question cards (§4.5a)", () => {
  it("options are buttons 1–9 on a desktop, and a number key answers", async () => {
    mockAnswer.mockImplementation(arg => ({
      post: { id: "p", ...arg },
      question: { questionId: "q1", answers: [] },
    }));
    wrap(<Card detail={item()} />);
    expect(screen.getByRole("button", { name: "1. Everyone" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "2" });
    await waitFor(() =>
      expect(mockAnswer).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: "sess-1", questionId: "q1", optionIds: ["o2"] }),
      ),
    );
    // Sent with an idempotency key, so a retried offline send returns the same post.
    expect(mockAnswer.mock.calls[0][0].idempotencyKey).toEqual(expect.any(String));
  });

  it("phone: options are full-width buttons without numbers", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    wrap(<Card detail={item()} />);
    expect(screen.getByRole("button", { name: "Everyone" })).toHaveClass("w-full");
  });

  it("conflicting answers wait for the settler, with names and roles", () => {
    mockAnswers = {
      comments: [],
      questions: [
        {
          questionId: "q1",
          prompt: question.prompt,
          answers: [
            post("a", { id: 1, name: "Ravi", relation: "author" }, "o1", "Everyone"),
            post("b", { id: 3, name: "Ana", relation: "builder" }, "o2", "Only new learners"),
          ],
          conflict: true,
          settler: { id: 2, name: "Priya", role: "builder" },
          chosenPostId: null,
          settledBy: null,
          batched: false,
        },
      ],
    };
    wrap(<Card detail={item()} />);
    expect(screen.getByText(en.roadmapV2.session.waitingFor("Priya"))).toBeInTheDocument();
    expect(
      screen.getByText(en.roadmapV2.session.answeredBy("Ravi", "submitter")),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: en.roadmapV2.session.useThisAnswer }),
    ).not.toBeInTheDocument();
  });

  it("the settler sees Use this answer on each, and choosing records it", async () => {
    mockChoose.mockReturnValue({ question: { questionId: "q1", answers: [] } });
    mockAnswers = {
      comments: [],
      questions: [
        {
          questionId: "q1",
          prompt: question.prompt,
          answers: [
            post("a", { id: 1, name: "Ravi", relation: "author" }, "o1", "Everyone"),
            post("b", { id: 3, name: "Ana", relation: "builder" }, "o2", "Only new learners"),
          ],
          conflict: true,
          settler: { id: 2, name: "Priya", role: "builder" },
          chosenPostId: null,
          settledBy: null,
          batched: false,
        },
      ],
    };
    wrap(<Card detail={item({ answer: true, settleAnswer: true })} />);
    const use = screen.getAllByRole("button", { name: en.roadmapV2.session.useThisAnswer });
    expect(use).toHaveLength(2);
    fireEvent.click(use[1]);
    await waitFor(() =>
      expect(mockChoose).toHaveBeenCalledWith({ sessionId: "sess-1", postId: "b" }),
    );
  });

  it("an answered card condenses to one line, the same under reduced motion", () => {
    mockAnswers = {
      comments: [],
      questions: [
        {
          questionId: "q1",
          prompt: question.prompt,
          answers: [post("a", { id: 1, name: "Ravi", relation: "author" }, "o1", "Everyone")],
          conflict: false,
          settler: null,
          chosenPostId: null,
          settledBy: null,
          batched: true,
        },
      ],
    };
    const full = wrap(<Card detail={item()} />);
    const label = `${en.roadmapV2.session.changeAnswer}: ${question.prompt}`;
    expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    full.unmount();
    setReduceMotionSwitch(true);
    wrap(<Card detail={item()} />);
    expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
  });

  it("shows who is answering this question right now", () => {
    publishRoadmapPresence({
      presence: [{ userId: 3, name: "Ana", kind: "typing", questionId: "q1", at: Date.now() }],
      announceTyping: vi.fn(),
    });
    wrap(<Card detail={item()} />);
    expect(screen.getByText(en.roadmapV2.idea.typing("Ana"))).toBeInTheDocument();
  });

  it("a Viewer gets no answer box", () => {
    wrap(<Card detail={item({})} />);
    expect(screen.queryByRole("button", { name: "1. Everyone" })).not.toBeInTheDocument();
  });
});

describe("the comment box (§4.5a)", () => {
  const Box: React.FC = () => {
    const detail = item();
    const session = useSessionAnswers(detail);
    return <CommentBox item={detail} session={session} />;
  };

  it("@ lists people, and the comment carries the mentioned ids and an idempotency key", async () => {
    mockComment.mockImplementation(arg => ({ post: { id: "c1", ...arg } }));
    wrap(<Box />);
    const box = screen.getByLabelText(en.roadmapV2.session.commentLabel);
    fireEvent.change(box, { target: { value: "Thanks @pri", selectionStart: 11 } });
    fireEvent.mouseDown(await screen.findByRole("option", { name: /Priya/ }));
    expect(box).toHaveValue("Thanks @Priya ");
    fireEvent.click(screen.getByRole("button", { name: en.roadmapV2.session.commentSend }));
    await waitFor(() =>
      expect(mockComment).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: "sess-1",
          text: "Thanks @Priya",
          mentionUserIds: [2],
        }),
      ),
    );
  });

  it("an offline comment waits on the device and says so", async () => {
    mockComment.mockImplementation(() => {
      throw { status: "FETCH_ERROR" };
    });
    wrap(<Box />);
    const box = screen.getByLabelText(en.roadmapV2.session.commentLabel);
    fireEvent.change(box, { target: { value: "Back soon" } });
    fireEvent.click(screen.getByRole("button", { name: en.roadmapV2.session.commentSend }));
    expect(await screen.findByText(en.roadmapV2.session.offline)).toBeInTheDocument();
    expect(screen.getByText("Back soon")).toBeInTheDocument();
  });
});
