import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

const item = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  runId: `run-${id}`,
  sessionId: `s-${id}`,
  section: "what_worked[0].body",
  quotedText: "named it plainly",
  body: "Exactly what I needed.",
  status: "open",
  language: "en-IN",
  tenantName: "Internal Testing",
  learnerName: "Tanuja Babre",
  createdAt: "2026-11-19T08:00:00Z",
  ...over,
});

let pages: Record<string, any> = {};
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGetDebriefLearnerCommentsQuery: ({ before }: { before?: string }) => ({
    data: pages[before ?? "first"],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));

/* eslint-disable import/first */
import { cardLabel, LearnerCommentsView } from "../pm/LearnerCommentsView";
/* eslint-enable import/first */

const show = () =>
  render(
    <MemoryRouter>
      <LearnerCommentsView />
    </MemoryRouter>,
  );

describe("Changes › Learner comments", () => {
  beforeEach(() => {
    pages = {};
  });

  it("lists each comment with who, where, the words, the card and a link to the debrief", () => {
    pages.first = {
      items: [item("a"), item("b", { section: null, quotedText: null, body: "Helpful." })],
      next: null,
    };
    show();
    const rows = screen.getAllByTestId("learner-comment-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Tanuja Babre");
    expect(rows[0]).toHaveTextContent("Internal Testing");
    expect(rows[0]).toHaveTextContent("“named it plainly”");
    expect(rows[0]).toHaveTextContent("What worked 1");
    expect(rows[1]).toHaveTextContent("On the whole debrief");
    expect(screen.getByTestId("learner-comment-open-a")).toHaveAttribute(
      "href",
      "/debriefs/sessions/run-a",
    );
  });

  it("says so when there are none yet", () => {
    pages.first = { items: [], next: null };
    show();
    expect(screen.getByTestId("learner-comments-none")).toBeInTheDocument();
  });

  it("loads older comments under the first page when asked", () => {
    pages.first = { items: [item("a")], next: "2026-11-19T08:00:00.000Z" };
    pages["2026-11-19T08:00:00.000Z"] = { items: [item("z", { body: "Older." })], next: null };
    show();
    expect(screen.getAllByTestId("learner-comment-row")).toHaveLength(1);
    fireEvent.click(screen.getByTestId("learner-comments-more"));
    expect(screen.getAllByTestId("learner-comment-row")).toHaveLength(2);
    expect(screen.queryByTestId("learner-comments-more")).not.toBeInTheDocument();
  });

  it("names a card in words", () => {
    expect(cardLabel("work_on_this[1].why")).toBe("Work on this 2");
    expect(cardLabel("opening")).toBe("Opening");
    expect(cardLabel("reflective_question")).toBe("Reflective question");
    expect(cardLabel(null)).toBe("On the whole debrief");
  });
});
