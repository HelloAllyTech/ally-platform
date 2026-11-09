import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ArticleItemPlayer } from "../ArticleItemPlayer";
import {
  ArticleQuestion,
  StartArticleItemPayload,
  TrackItemType,
} from "../../../../../types/tracks";

const markArticleRead = vi.fn();
const submitArticleQuestionAnswer = vi.fn();

vi.mock("@api", () => ({
  useMarkArticleReadMutation: () => [markArticleRead, { isLoading: false }],
  useGetArticleResourceEmbeddabilityQuery: () => ({ data: undefined }),
  useSubmitArticleQuestionAnswerMutation: () => [submitArticleQuestionAnswer, { isLoading: false }],
}));

vi.mock("@assets", () => ({
  ArrowRight: () => <span />,
  TickGreenBackground: () => <span data-testid="tick-icon" />,
}));

vi.mock("@ally-ui-mono/ui-shared", () => ({
  RichTextRenderer: ({ content }: { content: string }) => (
    <div dangerouslySetInnerHTML={{ __html: content }} />
  ),
  htmlToPlainText: (html: string) => html.replace(/<[^>]*>/g, ""),
}));

const question = (id: string): ArticleQuestion => ({
  id,
  type: "mcq_single",
  prompt: `Prompt ${id}`,
  points: 1,
  options: [
    { id: "a", text: `Option A (${id})` },
    { id: "b", text: `Option B (${id})` },
  ],
  answered: null,
  correctOptionId: null,
  explanation: null,
});

const HTML = [
  "<p>Intro paragraph.</p>",
  "<h2>Listening first</h2>",
  '<div data-ally-callout="say"><p>“Take your time.”</p></div>',
  '<div data-ally-question="q1"></div>',
  "<p>More on listening.</p>",
  "<h2>Closing the call</h2>",
  '<div data-ally-callout="warn"><p>Never promise secrecy.</p></div>',
].join("");

const payload = (over: Partial<StartArticleItemPayload> = {}): StartArticleItemPayload => ({
  type: TrackItemType.ARTICLE,
  trackItemProgressId: "progress-1",
  html: HTML,
  minReadSeconds: 0,
  questions: [question("q1")],
  answeredQuestionCount: 0,
  cover: { url: "/room.svg", alt: "A quiet room" },
  takeaways: ["Listen before you advise.", "Be honest about limits."],
  resources: [{ id: "r1", title: "Helpline guide", url: "https://example.org/guide" }],
  ...over,
});

const renderPlayer = (
  p: StartArticleItemPayload,
  extra: { onRequestNext?: () => void; forceClassic?: boolean } = {},
) => {
  const onCompleted = vi.fn();
  render(
    <ArticleItemPlayer
      payload={p}
      itemId="item-1"
      alreadyCompleted={false}
      onCompleted={onCompleted}
      title="First contact"
      description="How to open a call well."
      sectionTitle="Module 2"
      {...extra}
    />,
  );
  return { onCompleted };
};

const answer = async (id: string) => {
  submitArticleQuestionAnswer.mockReturnValue({
    unwrap: () =>
      Promise.resolve({
        correct: true,
        selectedOptionId: "a",
        correctOptionId: "a",
        explanation: null,
        answeredQuestionCount: 1,
        totalQuestionCount: 1,
        completion: null,
      }),
  });
  fireEvent.click(screen.getByRole("radio", { name: new RegExp(`Option A \\(${id}\\)`) }));
  fireEvent.click(screen.getByRole("button", { name: "Check answer" }));
  await screen.findByText("Correct");
};

beforeEach(() => {
  vi.clearAllMocks();
  markArticleRead.mockReturnValue({
    unwrap: () =>
      Promise.resolve({
        completed: true,
        unlockedItemIds: [],
        sectionCompleted: false,
        trackCompleted: false,
      }),
  });
});

describe("ArticleItemPlayer — classic (and any unknown experience)", () => {
  it("draws callouts with their labels, the cover banner and the takeaways", () => {
    renderPlayer(payload({ experience: "SOMETHING_NEW" as never }));
    expect(screen.getByText("Try saying")).toBeInTheDocument();
    expect(screen.getByText("Watch out")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "A quiet room" })).toBeInTheDocument();
    const takeaways = screen.getByTestId("article-takeaways");
    expect(within(takeaways).getByRole("heading", { name: "Key takeaways" })).toBeInTheDocument();
    expect(within(takeaways).getAllByRole("listitem")).toHaveLength(2);
    // Takeaways come before the resources.
    expect(
      takeaways.compareDocumentPosition(screen.getByText("Helpline guide")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.queryByTestId("article-magazine-header")).not.toBeInTheDocument();
    expect(screen.queryByTestId("article-cards")).not.toBeInTheDocument();
  });

  it("shows no cover or takeaways box when there are none", () => {
    renderPlayer(payload({ cover: null, takeaways: [] }));
    expect(screen.queryByTestId("article-cover")).not.toBeInTheDocument();
    expect(screen.queryByTestId("article-takeaways")).not.toBeInTheDocument();
  });

  it("stays classic when the host forces it", () => {
    renderPlayer(payload({ experience: "CARDS" }), { forceClassic: true });
    expect(screen.queryByTestId("article-cards")).not.toBeInTheDocument();
    expect(screen.getByTestId("article-question-q1")).toBeInTheDocument();
  });
});

describe("ArticleItemPlayer — magazine", () => {
  it("renders the hero, headline, meta and outline", () => {
    renderPlayer(payload({ experience: "MAGAZINE" }));
    const header = screen.getByTestId("article-magazine-header");
    expect(within(header).getByRole("img", { name: "A quiet room" })).toBeInTheDocument();
    expect(within(header).getByText("Module 2")).toBeInTheDocument();
    expect(
      within(header).getByRole("heading", { level: 1, name: "First contact" }),
    ).toBeInTheDocument();
    expect(within(header).getByText("How to open a call well.")).toBeInTheDocument();
    expect(within(header).getByText("1 min read")).toBeInTheDocument();
    expect(within(header).getByText("1 quick check")).toBeInTheDocument();

    const outline = screen.getByRole("navigation", { name: "In this article" });
    const entries = within(outline)
      .getAllByRole("button")
      .map(b => b.textContent);
    expect(entries).toEqual(["Listening first", "Closing the call", "Key takeaways"]);
    // Each entry points at a real heading.
    expect(document.getElementById("article-item-1-h0")).toHaveTextContent("Listening first");
    expect(document.getElementById("article-item-1-takeaways")).not.toBeNull();
    expect(document.querySelector("[data-ally-dropcap]")).toHaveTextContent("Intro paragraph.");
  });

  it("pluralises quick checks and leaves out the photo band without a cover", () => {
    renderPlayer(
      payload({
        experience: "MAGAZINE",
        cover: null,
        html: `${HTML}<div data-ally-question="q2"></div>`,
        questions: [question("q1"), question("q2")],
      }),
    );
    expect(screen.queryByTestId("article-cover")).not.toBeInTheDocument();
    expect(screen.getByText("2 quick checks")).toBeInTheDocument();
  });

  it("keeps the footer's question gating", () => {
    renderPlayer(payload({ experience: "MAGAZINE" }));
    expect(screen.getByRole("button", { name: "Answer the question to continue" })).toBeDisabled();
  });
});

describe("ArticleItemPlayer — cards", () => {
  const next = () => fireEvent.click(screen.getByRole("button", { name: /^Next/ }));
  const counter = () => screen.getByTestId("article-cards-counter").textContent;

  it("opens on the cover card", () => {
    renderPlayer(payload({ experience: "CARDS" }));
    const cover = screen.getByTestId("article-card-cover");
    expect(
      within(cover).getByRole("heading", { level: 1, name: "First contact" }),
    ).toBeInTheDocument();
    expect(within(cover).getByText("Module 2 · 1 min read")).toBeInTheDocument();
    expect(within(cover).getByRole("img", { name: "A quiet room" })).toBeInTheDocument();
    // cover, intro, Listening first, q1, rest of Listening first, Closing the call, end
    expect(counter()).toBe("1 / 7");
    expect(screen.queryByRole("button", { name: "Previous" })).not.toBeInTheDocument();
  });

  it("pages through, gates Next on the question, and marks read on the final card", async () => {
    const onRequestNext = vi.fn();
    const { onCompleted } = renderPlayer(payload({ experience: "CARDS" }), { onRequestNext });

    fireEvent.click(screen.getByRole("button", { name: /Start reading/ }));
    expect(await screen.findByText("Intro paragraph.")).toBeInTheDocument();
    expect(counter()).toBe("2 / 7");

    next();
    const heading = await screen.findByRole("heading", { level: 2, name: "Listening first" });
    const section = heading.closest<HTMLElement>("[data-testid='article-card-section']")!;
    expect(within(section).getByText("Try saying")).toBeInTheDocument();

    next();
    await screen.findByTestId("article-question-q1");
    const gated = screen.getByRole("button", { name: "Answer the question to continue" });
    expect(gated).toBeDisabled();
    // The arrow key can't skip it either.
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(counter()).toBe("4 / 7");

    await answer("q1");
    next();
    expect(await screen.findByText("More on listening.")).toBeInTheDocument();
    next();
    expect(await screen.findByText("Never promise secrecy.")).toBeInTheDocument();
    next();
    const end = await screen.findByTestId("article-card-end");
    expect(within(end).getByText("Key takeaways")).toBeInTheDocument();
    expect(within(end).getByText("Helpline guide")).toBeInTheDocument();
    expect(counter()).toBe("7 / 7");

    fireEvent.click(screen.getByRole("button", { name: "Mark as read" }));
    await waitFor(() => expect(onCompleted).toHaveBeenCalled());
    expect(markArticleRead).toHaveBeenCalledWith({ itemId: "item-1" });
    expect(await screen.findByText("Read")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
    expect(onRequestNext).toHaveBeenCalled();
  });

  it("moves with the arrow keys and the back button", async () => {
    renderPlayer(
      payload({ experience: "CARDS", questions: [], html: "<h2>A</h2><p>a</p><h2>B</h2><p>b</p>" }),
    );
    act(() => {
      fireEvent.keyDown(window, { key: "ArrowRight" });
    });
    await screen.findByText("a");
    fireEvent.keyDown(window, { key: "ArrowRight" });
    await screen.findByText("b");
    expect(counter()).toBe("3 / 4");
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    await screen.findByText("a");
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    await screen.findByTestId("article-card-cover");
  });

  it("makes the last content card final when there are no takeaways or resources", async () => {
    renderPlayer(
      payload({
        experience: "CARDS",
        questions: [],
        html: "<p>Only card</p>",
        takeaways: [],
        resources: [],
      }),
    );
    expect(counter()).toBe("1 / 2");
    fireEvent.click(screen.getByRole("button", { name: /Start reading/ }));
    await screen.findByText("Only card");
    expect(screen.getByRole("button", { name: "Mark as read" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /^Next/ })).not.toBeInTheDocument();
  });
});
