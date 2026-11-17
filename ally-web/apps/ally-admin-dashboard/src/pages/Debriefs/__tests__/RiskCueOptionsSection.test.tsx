import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import "@constants";

import { riskCue, WORDING } from "../../../components/debrief-roleplay-options/__tests__/fixtures";

const h = vi.hoisted(() => ({
  options: [] as unknown[],
  test: vi.fn(),
  approve: vi.fn(),
  reject: vi.fn(),
  retire: vi.fn(),
}));

vi.mock(
  "@ally-ui-mono/ui-shared",
  async () =>
    (await import("../../../components/ally-guide/__tests__/uiSharedFakes")).uiSharedFakes,
);
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGetRiskCueOptionsForReviewQuery: () => ({ isLoading: false, data: h.options }),
  useReviewTestRiskCueOptionMutation: () => [h.test, { isLoading: false }],
  useApproveRiskCueOptionMutation: () => [h.approve, { isLoading: false }],
  useRejectRiskCueOptionMutation: () => [h.reject, { isLoading: false }],
  useRetireRiskCueOptionMutation: () => [h.retire, { isLoading: false }],
}));

/* eslint-disable import/first */
import { RiskCueOptionsSection } from "../settings/RiskCueOptionsSection";
/* eslint-enable import/first */

const ok = (v: unknown = {}) => ({ unwrap: () => Promise.resolve(v) });
const fail = (message: string) => ({
  unwrap: () => Promise.reject({ status: 400, data: { message } }),
});

const waiting = riskCue({
  id: "w",
  key: "waiting",
  name: "Self-harm talk",
  wording: WORDING,
  status: "awaiting_approval",
  version: 3,
  examples: { cues: ["I want to end it"], nonCues: ["I am tired today"] },
  handling: "assessed",
  wordListRaises: false,
  testResult: {
    passed: true,
    reps: [],
    cueExamples: 1,
    nonCueExamples: 1,
    version: 3,
    at: "2026-11-17T00:00:00Z",
  },
});

describe("Settings › Risk-cue options", () => {
  beforeEach(() => {
    h.options = [riskCue(), waiting, riskCue({ id: "p", key: "peer", name: "Peer rule" })];
    for (const f of [h.test, h.approve, h.reject, h.retire]) f.mockReset();
  });

  it("lists waiting options first, each row truncating with status, handling and version in words", () => {
    render(<RiskCueOptionsSection canReview />);
    const rows = screen.getAllByTestId(/risk-cue-row-/);
    expect(rows.map(r => r.getAttribute("data-testid"))).toEqual([
      "risk-cue-row-waiting",
      "risk-cue-row-peer",
      "risk-cue-row-standard",
    ]);
    expect(rows[0]).toHaveClass("flex-nowrap");
    expect(rows[0]).toHaveTextContent("Waiting for review · Part of the practice · v3");
    expect(within(rows[0]).getByText("Self-harm talk")).toHaveClass("truncate");
  });

  it("shows the wording, behaviour in words, examples and last test for the chosen option", () => {
    render(<RiskCueOptionsSection canReview />);
    fireEvent.click(screen.getByTestId("risk-cue-row-waiting"));
    const d = screen.getByTestId("risk-cue-detail");
    expect(d).toHaveTextContent(WORDING);
    expect(d).toHaveTextContent("assessed in the coaching cards, with no alarm card");
    expect(d).toHaveTextContent("The safety word list does not mark cues as clear.");
    expect(d).toHaveTextContent("I want to end it");
    expect(d).toHaveTextContent("I am tired today");
    expect(d).toHaveTextContent("Passed on version 3.");
    fireEvent.click(screen.getByTestId("risk-cue-row-standard"));
    expect(screen.getByTestId("risk-cue-detail")).toHaveTextContent("The standard definition");
    expect(screen.getByTestId("risk-cue-detail")).toHaveTextContent("Not tested yet.");
  });

  it("runs the test, approves, and shows ally-be's refusal in plain words", async () => {
    render(<RiskCueOptionsSection canReview />);
    fireEvent.click(screen.getByTestId("risk-cue-row-waiting"));
    h.test.mockReturnValue(ok());
    fireEvent.click(screen.getByRole("button", { name: "Run test" }));
    expect(h.test).toHaveBeenCalledWith("w");
    h.approve.mockReturnValue(fail("Its test has not passed on this version."));
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(await screen.findByTestId("risk-cue-error")).toHaveTextContent(
      "Its test has not passed on this version.",
    );
    expect(h.approve).toHaveBeenCalledWith({ id: "w" });
  });

  it("turning down needs a note, and sends it", async () => {
    render(<RiskCueOptionsSection canReview />);
    fireEvent.click(screen.getByTestId("risk-cue-row-waiting"));
    fireEvent.click(screen.getByRole("button", { name: "Turn down" }));
    const send = screen.getAllByRole("button", { name: "Turn down" })[0];
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Note to the writer"), {
      target: { value: " Too broad. " },
    });
    h.reject.mockReturnValue(ok());
    fireEvent.click(screen.getAllByRole("button", { name: "Turn down" })[0]);
    await waitFor(() => expect(h.reject).toHaveBeenCalledWith({ id: "w", note: "Too broad." }));
  });

  it("retire is only for approved options other than Standard, and asks first", async () => {
    render(<RiskCueOptionsSection canReview />);
    fireEvent.click(screen.getByTestId("risk-cue-row-standard"));
    expect(screen.queryByRole("button", { name: "Retire" })).toBeNull();
    fireEvent.click(screen.getByTestId("risk-cue-row-waiting"));
    expect(screen.queryByRole("button", { name: "Retire" })).toBeNull();
    fireEvent.click(screen.getByTestId("risk-cue-row-peer"));
    h.retire.mockReturnValue(ok());
    fireEvent.click(screen.getByRole("button", { name: "Retire" }));
    expect(h.retire).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Retire" }));
    await waitFor(() => expect(h.retire).toHaveBeenCalledWith("p"));
  });

  it("has no actions for someone who cannot review", () => {
    render(<RiskCueOptionsSection canReview={false} />);
    fireEvent.click(screen.getByTestId("risk-cue-row-waiting"));
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });
});
