import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAddDebriefCommentMutation: () => [vi.fn(), { isLoading: false }],
  useEditDebriefCommentMutation: () => [vi.fn()],
  useDeleteDebriefCommentMutation: () => [vi.fn(), { isLoading: false }],
  useSetDebriefCommentStatusMutation: () => [vi.fn(), { isLoading: false }],
}));

/* eslint-disable import/first */
import type { ExpertComment } from "@types";

import { Thread } from "../session/commentParts";
/* eslint-enable import/first */

const comment = (over: Partial<ExpertComment> = {}): ExpertComment => ({
  id: "c1",
  runId: "r1",
  parentId: null,
  anchorKind: "card",
  turnIndex: null,
  section: "what_worked[0].body",
  spanStart: 4,
  spanEnd: 20,
  quotedText: "named it plainly",
  body: "This is exactly what I wanted to hear.",
  tag: null,
  status: "open",
  reviewer: { id: 7, name: "Tanuja Babre" },
  mine: false,
  createdAt: "2026-11-19T08:00:00Z",
  updatedAt: "2026-11-19T08:00:00Z",
  resolvedAt: null,
  idea: null,
  repeatOf: null,
  ...over,
});

const show = (c: ExpertComment) =>
  render(<Thread root={c} replies={[]} runId="r1" active={false} onFocus={() => {}} canAct />);

describe("a learner's comment in the review screens", () => {
  it("says it is from the learner", () => {
    show(comment({ source: "learner" }));
    expect(screen.getByTestId("comment-from-learner")).toHaveTextContent("From the learner");
  });

  it("an expert's comment, and one from before the field existed, carry no such label", () => {
    const { unmount } = show(comment({ source: "expert" }));
    expect(screen.queryByTestId("comment-from-learner")).not.toBeInTheDocument();
    unmount();
    show(comment());
    expect(screen.queryByTestId("comment-from-learner")).not.toBeInTheDocument();
  });
});
