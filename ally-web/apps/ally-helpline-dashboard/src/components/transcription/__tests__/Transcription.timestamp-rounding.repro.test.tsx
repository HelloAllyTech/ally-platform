import React from "react";

import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

import Transcription from "../Transcription";

// Mock CSS import
vi.mock("../styles.css", () => ({}));

// Mock react-router-dom
vi.mock("react-router-dom", () => ({
  useParams: () => ({ reviewId: "test-review-id" }),
}));

// Mock InfiniteScroll
vi.mock("@ally-ui-mono/ui-shared/index", () => ({
  InfiniteScroll: ({ children, onInfiniteScroll, isLoading }: any) => (
    <div data-testid="infinite-scroll" data-loading={isLoading}>
      {children}
      <button data-testid="load-more-trigger" onClick={onInfiniteScroll}>
        Load More
      </button>
    </div>
  ),
}));

// Mock SelectableText component
vi.mock("@src/components/selectable-text/SelectableText", () => ({
  default: ({ segment, segIdx }: any) => (
    <span data-testid={`selectable-text-${segIdx}`}>{segment.text}</span>
  ),
}));

// Mock utils
vi.mock("../utils", () => ({
  getFreshUserRange: vi.fn(),
  splitByCommentRanges: (content: string, threads: any[]) => [
    {
      text: content,
      commentIds: [],
      start: 0,
      end: content.length,
    },
  ],
}));

// Repro for: Transcript timestamps show 00:60 near minute boundaries on Review Details
// When startSeconds is a fractional value close to a minute boundary (e.g. 59.6),
// the component currently renders 00:60 instead of carrying to 01:00.

describe("Transcription timestamp rounding near minute boundaries", () => {
  it("should roll over to the next minute (59.6 -> 01:00, 119.7 -> 02:00)", () => {
    const transcriptList = [
      { id: 1, content: "Msg A", senderId: -1, startSeconds: 59.6, threads: [] },
      { id: 2, content: "Msg B", senderId: -1, startSeconds: 119.7, threads: [] },
    ] as any;

    render(
      <Transcription
        transcriptList={transcriptList}
        userId={1}
        onCommentChange={() => {}}
        onDeleteComment={() => {}}
      />,
    );

    // Correct behaviour would display 01:00 and 02:00; the buggy code shows 00:60 and 01:60
    expect(screen.getByText("01:00")).toBeInTheDocument();
    expect(screen.getByText("02:00")).toBeInTheDocument();
  });
});
