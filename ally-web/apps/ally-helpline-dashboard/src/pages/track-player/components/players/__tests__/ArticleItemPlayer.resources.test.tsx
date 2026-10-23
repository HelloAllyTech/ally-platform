import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ArticleItemPlayer } from "../ArticleItemPlayer";
import {
  ArticleResourceEmbeddabilityResponse,
  StartArticleItemPayload,
  TrackItemType,
} from "../../../../../types/tracks";

let embeddability: ArticleResourceEmbeddabilityResponse | undefined;
const embeddabilityQuery = vi.fn(() => ({ data: embeddability }));

vi.mock("@api", () => ({
  useMarkArticleReadMutation: () => [vi.fn(), { isLoading: false }],
  useSubmitArticleQuestionAnswerMutation: () => [vi.fn(), { isLoading: false }],
  useGetArticleResourceEmbeddabilityQuery: (...args: unknown[]) =>
    embeddabilityQuery(...(args as [])),
}));

vi.mock("@assets", () => ({
  ArrowRight: () => <span />,
  TickGreenBackground: () => <span />,
}));

vi.mock("@ally-ui-mono/ui-shared", () => ({
  RichTextRenderer: ({ content }: { content: string }) => (
    <div dangerouslySetInnerHTML={{ __html: content }} />
  ),
}));

vi.mock("../ExternalResourceModal", () => ({
  openInNewTab: vi.fn(),
  ExternalResourceModal: ({ resource }: { resource: { title: string } }) => (
    <div data-testid="embed-modal">{resource.title}</div>
  ),
}));

const { openInNewTab } = await import("../ExternalResourceModal");

const payload = (
  resources: StartArticleItemPayload["resources"] = [
    { id: "rg", title: "QACP Resource Book", url: "https://www.researchgate.net/x" },
    { id: "wiki", title: "Counselling", url: "https://en.wikipedia.org/wiki/Counseling" },
  ],
): StartArticleItemPayload => ({
  type: TrackItemType.ARTICLE,
  trackItemProgressId: "progress-1",
  html: "<p>Body</p>",
  minReadSeconds: 0,
  questions: [],
  answeredQuestionCount: 0,
  resources,
});

const renderPlayer = (p = payload()) =>
  render(
    <ArticleItemPlayer payload={p} itemId="item-1" alreadyCompleted={false} onCompleted={vi.fn()} />,
  );

describe("ArticleItemPlayer — resources", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    embeddability = undefined;
  });

  it("opens a resource the server flagged straight in a new tab", () => {
    embeddability = {
      resources: [
        { id: "rg", openExternally: true },
        { id: "wiki", openExternally: false },
      ],
    };
    renderPlayer();
    fireEvent.click(screen.getByText("QACP Resource Book"));
    expect(openInNewTab).toHaveBeenCalledWith("https://www.researchgate.net/x");
    expect(screen.queryByTestId("embed-modal")).toBeNull();
  });

  it("embeds a resource the server found embeddable", () => {
    embeddability = { resources: [{ id: "wiki", openExternally: false }] };
    renderPlayer();
    fireEvent.click(screen.getByText("Counselling"));
    expect(openInNewTab).not.toHaveBeenCalled();
    expect(screen.getByTestId("embed-modal")).toHaveTextContent("Counselling");
  });

  it("falls back to the embed while the check has not answered", () => {
    renderPlayer();
    fireEvent.click(screen.getByText("QACP Resource Book"));
    expect(openInNewTab).not.toHaveBeenCalled();
    expect(screen.getByTestId("embed-modal")).toBeInTheDocument();
  });

  it("skips the check for an article without resources", () => {
    renderPlayer(payload([]));
    expect(embeddabilityQuery).toHaveBeenCalledWith({ itemId: "item-1" }, { skip: true });
  });
});
