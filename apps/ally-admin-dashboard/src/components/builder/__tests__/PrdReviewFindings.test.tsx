import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { en } from "@constants";
import type { BuilderPrdReview } from "@types";

// @constants reads off the @components barrel at module-eval time (see the
// BugHunter tests), so the barrel is stubbed rather than loaded for real.
vi.mock("@components", () => ({ cellTypes: {} }));
vi.mock("@assets", () => ({ TooltipIcon: () => <svg /> }));

vi.mock("@ally-ui-mono/ui-shared", () => ({
  Button: ({ children, onClick, disabled }: any) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  Tag: ({ children }: any) => <span>{children}</span>,
  TextArea: ({ id, value, onChange, placeholder }: any) => (
    <textarea id={id} value={value} onChange={onChange} placeholder={placeholder} />
  ),
  Tooltip: ({ children }: any) => <>{children}</>,
}));

// eslint-disable-next-line import/first
import { PrdReviewFindings } from "../PrdReviewFindings";

const strings = en.builder.prd.review;

const review = (overrides: Partial<BuilderPrdReview> = {}): BuilderPrdReview => ({
  status: "done",
  versionNumber: 8,
  checkedVersion: 8,
  model: "gpt-5-mini",
  reviewedAt: "2026-10-21T10:00:00Z",
  checkedAt: "2026-10-21T10:00:00Z",
  findings: [
    {
      id: "F1",
      category: "unapplied_correction",
      section: "requirements",
      detail: "R3 still adds a challenger job.",
      fix: "Reuse Auto-improve instead of R3.",
      quote: "Auto-improve already writes challengers",
      status: "open",
      raisedInVersion: 8,
    },
    {
      id: "F2",
      category: "missing_success_metric",
      section: "goals",
      detail: "No measurable outcome.",
      fix: "Name the thumbs-up rate.",
      status: "dismissed",
      raisedInVersion: 8,
      dismissal: { reason: "Target set after launch.", by: 1, at: "now", via: "admin" },
    },
  ],
  ...overrides,
});

describe("PrdReviewFindings", () => {
  it("renders nothing before the first review", () => {
    const { container } = render(<PrdReviewFindings review={null} editable />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows an open finding with its category, section and fix", () => {
    render(<PrdReviewFindings review={review()} editable onDismiss={vi.fn()} />);

    expect(screen.getByText(strings.categories.unapplied_correction)).toBeInTheDocument();
    expect(screen.getByText(strings.sectionLabel("Requirements"))).toBeInTheDocument();
    expect(screen.getByText("Reuse Auto-improve instead of R3.")).toBeInTheDocument();
    expect(screen.getByText("Auto-improve already writes challengers")).toBeInTheDocument();
    // Resolved findings fold away, with their count.
    expect(screen.getByText(strings.resolvedHeading(1))).toBeInTheDocument();
  });

  it("only dismisses with a real reason, and passes the reason through", async () => {
    const onDismiss = vi.fn().mockResolvedValue(undefined);
    render(<PrdReviewFindings review={review()} editable onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole("button", { name: strings.dismiss }));
    const confirm = screen.getByRole("button", { name: strings.confirmDismiss });
    const field = screen.getByPlaceholderText(strings.dismissPlaceholder);

    fireEvent.change(field, { target: { value: "wrong" } });
    expect(confirm).toBeDisabled();

    fireEvent.change(field, { target: { value: "Auto-improve is not on for this prompt." } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(onDismiss).toHaveBeenCalledWith("F1", "Auto-improve is not on for this prompt."),
    );
  });

  it("offers no dismiss while the PRD is locked", () => {
    render(<PrdReviewFindings review={review()} editable={false} onDismiss={vi.fn()} />);
    expect(screen.queryByRole("button", { name: strings.dismiss })).not.toBeInTheDocument();
  });

  it("says a failed review does not block", () => {
    render(<PrdReviewFindings review={review({ status: "failed", findings: [] })} editable />);
    expect(screen.getByText(strings.failed)).toBeInTheDocument();
  });

  it("says when the review found nothing", () => {
    render(<PrdReviewFindings review={review({ findings: [] })} editable />);
    expect(screen.getByText(strings.clean)).toBeInTheDocument();
  });
});
