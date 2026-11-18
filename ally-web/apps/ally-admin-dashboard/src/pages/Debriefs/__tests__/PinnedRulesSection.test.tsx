import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

vi.mock(
  "@ally-ui-mono/ui-shared",
  async () =>
    (await import("../../../components/ally-guide/__tests__/uiSharedFakes")).uiSharedFakes,
);
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGetDebriefPinnedRulesQuery: () => ({
    data: {
      rules: [
        {
          code: "debrief_safety_reader_system",
          label: "Safety rules",
          version: 1,
          pinnedByRelease: false,
          inBundle: true,
          signedBy: { id: 7, name: "Asha" },
          signedAt: "2026-11-12T10:00:00Z",
          ideaId: "i",
          writtenBy: null,
          writtenAt: null,
          note: null,
          text: "Find every risk cue.",
        },
        {
          code: "debrief_quality_rubric",
          label: "Rubric (the Evaluator and the judge score by it)",
          version: 2,
          pinnedByRelease: false,
          inBundle: true,
          signedBy: null,
          signedAt: null,
          ideaId: null,
          writtenBy: null,
          writtenAt: null,
          note: null,
          text: "Score eight dimensions.",
        },
      ],
      proposals: [
        { id: "p1", change: { promptCode: "debrief_quality_rubric" } },
        { id: "f1", change: { promptCode: "debrief_quality_rubric", firstVersion: true } },
      ],
    },
  }),
  useProposePinnedRuleMutation: () => [vi.fn(), { isLoading: false }],
}));

/* eslint-disable import/first */
import { PinnedRulesSection } from "../settings/PinnedRulesSection";
/* eslint-enable import/first */

describe("Settings › Pinned rules", () => {
  it("says who approved each rule, never who signed it", () => {
    render(<PinnedRulesSection canAsk={false} />);
    expect(screen.getByText(/^Approved by Asha/)).toBeInTheDocument();
    expect(screen.getByText("Not approved yet")).toBeInTheDocument();
    expect(screen.queryByText(/Signed/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Ask for a change" })).toBeNull();
  });

  it("the advisor or owner asks for a change on a rule, told what else is waiting", () => {
    render(<PinnedRulesSection canAsk />);
    const asks = screen.getAllByRole("button", { name: "Ask for a change" });
    expect(asks).toHaveLength(2);
    fireEvent.click(asks[1]);
    const form = screen.getByTestId("pinned-rule-ask");
    expect(form).toHaveTextContent("Ask for a change to the Rubric");
    expect(form).toHaveTextContent("Score eight dimensions.");
    expect(form).toHaveTextContent("Another change to this rule is already waiting.");
  });
});
