import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ArticleQuestion, VideoInterjection } from "../../../../../types/tracks";
import { ArticleQuestionCard } from "../ArticleQuestionCard";
import { VideoInterjectionOverlay } from "../VideoInterjectionOverlay";

vi.mock("@api", () => ({
  useSubmitArticleQuestionAnswerMutation: () => [vi.fn(), { isLoading: false }],
  useSubmitInterjectionAnswerMutation: () => [vi.fn(), { isLoading: false }],
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@ally-ui-mono/ui-shared", () => ({
  RichTextRenderer: ({ content }: { content: string }) => (
    <div data-testid="rich-text">{content}</div>
  ),
  htmlToPlainText: (html: string) => html.replace(/<[^>]*>/g, ""),
}));

vi.mock("../QuestionMedia", () => ({ QuestionMedia: () => null }));

const question = (overrides: Partial<ArticleQuestion> = {}): ArticleQuestion => ({
  id: "q1",
  type: "mcq_single",
  prompt: "Plain prompt",
  points: 1,
  options: [
    { id: "a", text: "A" },
    { id: "b", text: "B" },
  ],
  ...overrides,
});

describe("article inline question prompt", () => {
  it("renders promptHtml through the rich text renderer", () => {
    render(
      <ArticleQuestionCard
        itemId="i"
        question={question({ promptHtml: "<p>Rich <strong>prompt</strong></p>" })}
        onAnswered={vi.fn()}
      />,
    );

    expect(screen.getByTestId("rich-text")).toHaveTextContent("Rich <strong>prompt</strong>");
    expect(screen.queryByText("Plain prompt")).not.toBeInTheDocument();
  });

  it("falls back to the plain prompt without promptHtml", () => {
    render(<ArticleQuestionCard itemId="i" question={question()} onAnswered={vi.fn()} />);

    expect(screen.getByText("Plain prompt")).toBeInTheDocument();
    expect(screen.queryByTestId("rich-text")).not.toBeInTheDocument();
  });

  it("falls back to the plain prompt when promptHtml has no text", () => {
    render(
      <ArticleQuestionCard
        itemId="i"
        question={question({ promptHtml: "<p></p>" })}
        onAnswered={vi.fn()}
      />,
    );

    expect(screen.getByText("Plain prompt")).toBeInTheDocument();
  });
});

describe("video interjection prompt", () => {
  const interjection = (overrides: Partial<ArticleQuestion> = {}): VideoInterjection =>
    ({ id: "int1", timestampSeconds: 5, question: question(overrides) }) as VideoInterjection;

  it("renders promptHtml through the rich text renderer", () => {
    render(
      <VideoInterjectionOverlay
        itemId="i"
        interjection={interjection({ promptHtml: "<p>Rich prompt</p>" })}
        onContinue={vi.fn()}
      />,
    );

    expect(screen.getByTestId("rich-text")).toHaveTextContent("<p>Rich prompt</p>");
    expect(screen.queryByText("Plain prompt")).not.toBeInTheDocument();
  });

  it("falls back to the plain prompt without promptHtml", () => {
    render(
      <VideoInterjectionOverlay itemId="i" interjection={interjection()} onContinue={vi.fn()} />,
    );

    expect(screen.getByText("Plain prompt")).toBeInTheDocument();
    expect(screen.queryByTestId("rich-text")).not.toBeInTheDocument();
  });
});
