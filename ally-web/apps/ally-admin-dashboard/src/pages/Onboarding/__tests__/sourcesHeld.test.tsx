import React from "react";

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

const refetchReview = vi.hoisted(() => vi.fn());

/** TF1 F4: a held PDF showed a raw "needs_review", and Approve was only in Knowledge. */
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGetBotDraftQuery: () => ({ data: undefined }),
  useGetBotDraftSourcesQuery: () => ({ data: { queue: [] } }),
  useGetChatbotDocumentsQuery: () => ({
    data: [
      { id: "k1", title: "saathi.pdf", status: "needs_review", archived: false, isGlobal: false },
    ],
  }),
  useGetKnowledgeReviewQuery: () => ({
    refetch: refetchReview,
    data: {
      documents: [
        {
          id: "k1",
          title: "saathi.pdf",
          findings: [{ kind: "name", count: 1, sample: "Ka****na" }],
        },
      ],
    },
  }),
  useApproveKnowledgeMutation: () => [vi.fn(), { isLoading: false }],
  useExcludeKnowledgeMutation: () => [vi.fn(), { isLoading: false }],
}));

/* eslint-disable import/first */
import { TF1_COPY } from "../../AssistantHome/copy/tf1";
import { SourcesSection } from "../create/Sources";
/* eslint-enable import/first */

describe("a file held for personal details, in Create", () => {
  it("says so in words and offers the review right there", () => {
    render(
      <SourcesSection
        draftId="d1"
        chatbotId="bot-1"
        pending={[]}
        creditsOut={false}
        addAddress={vi.fn()}
        addFiles={vi.fn()}
        onCreditsOut={vi.fn()}
      />,
    );
    expect(screen.getByText(TF1_COPY.sources.held)).toBeTruthy();
    expect(screen.queryByText("needs_review")).toBeNull();
    expect(screen.getByTestId("knowledge-review")).toBeTruthy();
    // TF1 round 2, N-3: the panel said "Nothing is waiting" until a reload; a newly held source
    // fetches the review list again, so the two agree.
    expect(refetchReview).toHaveBeenCalled();
  });
});
