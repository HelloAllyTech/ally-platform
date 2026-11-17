import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import "@constants";

import { riskCue, WORDING } from "./fixtures";

const h = vi.hoisted(() => ({
  options: [] as unknown[],
  create: vi.fn(),
  update: vi.fn(),
  test: vi.fn(),
  submit: vi.fn(),
  testing: false,
}));

vi.mock(
  "@ally-ui-mono/ui-shared",
  async () => (await import("../../ally-guide/__tests__/uiSharedFakes")).uiSharedFakes,
);
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGetRiskCueOptionsQuery: () => ({ isLoading: false, data: h.options }),
  useCreateRiskCueOptionMutation: () => [h.create, { isLoading: false }],
  useUpdateRiskCueOptionMutation: () => [h.update, { isLoading: false }],
  useTestRiskCueOptionMutation: () => [h.test, { isLoading: h.testing }],
  useSubmitRiskCueOptionMutation: () => [h.submit, { isLoading: false }],
}));

/* eslint-disable import/first */
import { RiskCueDialog } from "../RiskCueDialog";
/* eslint-enable import/first */

const ok = (v: unknown = {}) => ({ unwrap: () => Promise.resolve(v) });
const fail = (data: unknown) => ({ unwrap: () => Promise.reject({ status: 400, data }) });

const fill = () => {
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Self-harm talk" } });
  fireEvent.change(screen.getByLabelText("What counts as a risk cue here"), {
    target: { value: WORDING },
  });
  fireEvent.change(screen.getByLabelText("Lines that ARE a risk cue here"), {
    target: { value: "I want to end it\n\n  I can't go on " },
  });
  fireEvent.change(screen.getByLabelText("Lines that are NOT a risk cue here"), {
    target: { value: "I am tired today" },
  });
};

const draft = (over = {}) =>
  riskCue({
    id: "d1",
    key: "self-harm",
    name: "Self-harm talk",
    wording: WORDING,
    status: "draft",
    mine: true,
    version: 2,
    examples: { cues: ["I want to end it"], nonCues: ["I am tired today"] },
    ...over,
  });

describe("Risk-cue option dialog", () => {
  beforeEach(() => {
    Object.assign(h, { options: [], testing: false });
    for (const f of [h.create, h.update, h.test, h.submit]) f.mockReset();
  });

  it("explains what is missing and sends nothing until the form is valid", () => {
    render(<RiskCueDialog optionId={null} onClose={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(screen.getByText("Give it a name.")).toBeInTheDocument();
    expect(screen.getByText("Write at least 60 characters.")).toBeInTheDocument();
    expect(screen.getAllByText("Add at least one example.")).toHaveLength(2);
    expect(h.create).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Lines that ARE a risk cue here"), {
      target: { value: Array.from({ length: 13 }, (_, i) => `line ${i}`).join("\n") },
    });
    expect(screen.getByText("Use at most 12 lines.")).toBeInTheDocument();
  });

  it("saves a draft with the handling, both switches (on by default) and one example per line", async () => {
    h.create.mockReturnValue(ok(draft()));
    render(<RiskCueDialog optionId={null} onClose={() => undefined} />);
    fill();
    fireEvent.click(screen.getByLabelText(/^Part of the practice: the reader decides/));
    fireEvent.click(screen.getByLabelText("Show the support lines after the character's risk cue"));
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(h.create).toHaveBeenCalledTimes(1));
    expect(h.create).toHaveBeenCalledWith({
      name: "Self-harm talk",
      wording: WORDING,
      handling: "assessed",
      wordListRaises: true,
      supportLinesOnCue: false,
      examples: { cues: ["I want to end it", "I can't go on"], nonCues: ["I am tired today"] },
    });
  });

  it("sends handling alarm by default, with Alarm chosen and no list of kinds", async () => {
    h.create.mockReturnValue(ok(draft()));
    render(<RiskCueDialog optionId={null} onClose={() => undefined} />);
    expect(screen.getByText("How a risk cue is handled")).toBeInTheDocument();
    expect(
      screen.getByLabelText("Alarm: every risk cue gets an important moment in the debrief"),
    ).toBeChecked();
    expect(screen.queryByRole("checkbox")).toBeNull();
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(h.create).toHaveBeenCalledTimes(1));
    expect(h.create.mock.calls[0][0].handling).toBe("alarm");
    expect(h.create.mock.calls[0][0]).not.toHaveProperty("assessedCategories");
  });

  it("opens a saved option with its handling chosen", () => {
    h.options = [draft({ handling: "assessed" })];
    render(<RiskCueDialog optionId="d1" onClose={() => undefined} />);
    expect(screen.getByLabelText(/^Part of the practice: the reader decides/)).toBeChecked();
  });

  it("shows the server's message and problems", async () => {
    h.create.mockReturnValue(
      fail({ message: "That name is taken.", problems: ["Add a clearer example."] }),
    );
    render(<RiskCueDialog optionId={null} onClose={() => undefined} />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(await screen.findByTestId("risk-cue-error")).toHaveTextContent(
      "That name is taken. Add a clearer example.",
    );
  });

  it("edits a saved draft with PATCH, and only sends changes it has saved", async () => {
    h.options = [draft()];
    h.update.mockReturnValue(ok());
    render(<RiskCueDialog optionId="d1" onClose={() => undefined} />);
    expect(screen.getByRole("button", { name: "Test it" })).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Self-harm talk 2" } });
    expect(screen.getByRole("button", { name: "Test it" })).toBeDisabled();
    expect(screen.getByText("Save your changes first.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(h.update).toHaveBeenCalled());
    expect(h.update.mock.calls[0][0]).toMatchObject({
      id: "d1",
      changes: { name: "Self-harm talk 2" },
    });
  });

  it("shows a busy state while testing, then what was missed or wrongly flagged per run", async () => {
    h.options = [
      draft({
        testResult: {
          passed: false,
          cueExamples: 1,
          nonCueExamples: 1,
          version: 2,
          at: "2026-11-17T00:00:00Z",
          reps: [
            { rep: 1, missed: ["I can't go on"], false_clear: [] },
            { rep: 2, missed: [], false_clear: ["I am tired today"] },
          ],
        },
      }),
    ];
    let done: (v: unknown) => void = () => undefined;
    h.test.mockReturnValue({ unwrap: () => new Promise(r => (done = r)) });
    render(<RiskCueDialog optionId="d1" onClose={() => undefined} />);
    expect(screen.getByText("Not passed.")).toBeInTheDocument();
    expect(screen.getByText('Missed a risk cue: "I can\'t go on"')).toBeInTheDocument();
    expect(
      screen.getByText('Flagged as a risk cue by mistake: "I am tired today"'),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send for approval" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Test it" }));
    expect(h.test).toHaveBeenCalledWith("d1");
    done({});
  });

  it("shows the busy line while the test runs", () => {
    h.options = [draft()];
    h.testing = true;
    render(<RiskCueDialog optionId="d1" onClose={() => undefined} />);
    expect(screen.getByTestId("risk-cue-testing")).toHaveTextContent("up to a minute");
    expect(screen.getByRole("button", { name: "Test it" })).toBeDisabled();
  });

  it("sends for approval only after a pass on this version, and shows ally-be's refusal", async () => {
    const passed = (version: number) => ({
      passed: true,
      reps: [],
      cueExamples: 1,
      nonCueExamples: 1,
      version,
      at: "2026-11-17T00:00:00Z",
    });
    h.options = [draft({ testResult: passed(1) })];
    const { rerender } = render(<RiskCueDialog optionId="d1" onClose={() => undefined} />);
    expect(
      screen.getByText("You changed it since the last test. Test it again."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send for approval" })).toBeDisabled();

    h.options = [draft({ testResult: passed(2) })];
    rerender(<RiskCueDialog optionId="d1" onClose={() => undefined} />);
    expect(screen.getByRole("button", { name: "Send for approval" })).toBeEnabled();
    h.submit.mockReturnValue(fail({ message: "Run a passing test first." }));
    fireEvent.click(screen.getByRole("button", { name: "Send for approval" }));
    expect(await screen.findByTestId("risk-cue-error")).toHaveTextContent(
      "Run a passing test first.",
    );
    expect(h.submit).toHaveBeenCalledWith("d1");
  });

  it("shows a clinical advisor's note when they turned it down", () => {
    h.options = [draft({ reviewNote: "Too broad." })];
    render(<RiskCueDialog optionId="d1" onClose={() => undefined} />);
    expect(screen.getByTestId("risk-cue-review-note")).toHaveTextContent(
      "A clinical advisor turned it down: Too broad.",
    );
  });
});
