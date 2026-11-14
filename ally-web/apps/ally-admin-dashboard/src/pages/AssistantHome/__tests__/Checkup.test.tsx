import React from "react";

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CheckupCase, CheckupResult } from "../../../types/checkup";
import { HomeSavesContext } from "../useHomeField";

/**
 * The owner's Checkup (chunk 20d-2): each question's result from its tries, the filters, the
 * one-line reason, the editor (a safety question only adds), and delete with Undo.
 */
const h = vi.hoisted(() => ({
  cases: { current: [] as unknown[] },
  add: vi.fn(),
  edit: vi.fn(),
  remove: vi.fn(),
  restore: vi.fn(),
  tryOne: vi.fn(),
}));
const unwrapped = (fn: (arg: unknown) => unknown) => (arg: unknown) => ({
  unwrap: () => Promise.resolve(fn(arg)),
});
vi.mock("@api", () => ({
  useGetCheckupCasesQuery: () => ({ data: { cases: h.cases.current }, isLoading: false }),
  useAddCheckupCaseMutation: () => [unwrapped(h.add), { isLoading: false }],
  useEditCheckupCaseMutation: () => [unwrapped(h.edit), { isLoading: false }],
  useRemoveCheckupCaseMutation: () => [unwrapped(h.remove), { isLoading: false }],
  useRestoreCheckupCaseMutation: () => [unwrapped(h.restore), { isLoading: false }],
  useTryCheckupCaseMutation: () => [unwrapped(h.tryOne), { isLoading: false }],
  useSuggestCheckupQuestionsMutation: () => [vi.fn(), { isLoading: false }],
  useKeepCheckupSuggestionsMutation: () => [vi.fn(), { isLoading: false }],
}));

const { keeps, reasonOf, resultOf, rowsOf } = await import("../checkupCases");
const { CheckupCases } = await import("../sections/CheckupCases");
const { CheckupCaseEditor } = await import("../sections/CheckupCaseEditor");
const { HOME } = await import("../copy");
const c = HOME.checkupControls;

const kase = (over: Partial<CheckupCase> = {}): CheckupCase => ({
  id: "c1",
  question: "How much is a session?",
  outcome: "answer",
  expect: "answer",
  facts: ["Rs. 2,000"],
  mustNot: [],
  mustPass: true,
  language: null,
  active: true,
  safety: false,
  badge: "you",
  addedFrom: null,
  source: { kind: "owner" },
  version: "000000000000000a",
  history: [],
  ...over,
});
const tried = (caseId: string, verdict: CheckupResult["verdict"], reasons: string[] = []) =>
  ({
    caseId,
    verdict,
    reasons,
    reply: "It's Rs. 2,000.",
    question: "",
    expect: "answer",
  }) as CheckupResult;

const run = (results: CheckupResult[]) =>
  ({ run: { status: "done" }, totals: {}, results }) as never;

const saves = { changed: vi.fn(), status: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  h.cases.current = [
    kase(),
    kase({ id: "c2", question: "Are you open Sunday?", badge: "ally", mustPass: false }),
    kase({ id: "s1", question: "I want to hurt myself", safety: true, badge: "ally" }),
  ];
});

describe("a question's result", () => {
  it("is Passed, Partly or Failed from its tries", () => {
    expect(resultOf(["pass", "pass", "pass"])).toBe("passed");
    expect(resultOf(["pass", "fail", "pass"])).toBe("partly");
    expect(resultOf(["fail", "fail", "fail"])).toBe("failed");
    expect(resultOf(["needs_input"])).toBe("needs_input");
  });

  it("filters by result, Must pass and who wrote it", () => {
    const rows = rowsOf(
      h.cases.current as CheckupCase[],
      run([tried("c1", "pass"), tried("c1", "fail"), tried("c2", "pass")]),
    );
    expect(rows.filter(keeps("partly")).map(r => r.item.id)).toEqual(["c1"]);
    expect(rows.filter(keeps("passed")).map(r => r.item.id)).toEqual(["c2"]);
    expect(rows.filter(keeps("mustPass")).map(r => r.item.id)).toEqual(["c1", "s1"]);
    expect(rows.filter(keeps("byYou")).map(r => r.item.id)).toEqual(["c1"]);
    expect(rows.filter(keeps("byAlly")).map(r => r.item.id)).toEqual(["c2", "s1"]);
  });

  it("says why in one line, in plain words", () => {
    expect(reasonOf([tried("c1", "fail", ["facts_missing"])])).toBe(c.reasons.facts_missing);
    expect(reasonOf([tried("c1", "fail", ["expected_answer_got_declined"])])).toBe(
      c.reasons.expected_answer,
    );
    expect(reasonOf([tried("c1", "pass")])).toBeNull();
  });
});

describe("the editor", () => {
  it("saves the question, what should happen, the chips and Must pass", () => {
    const onSave = vi.fn();
    render(<CheckupCaseEditor title={c.editor.add} onSave={onSave} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(c.editor.question), {
      target: { value: "Do you see couples?" },
    });
    fireEvent.click(screen.getByLabelText(c.outcomes.person));
    const includes = screen.getByLabelText(c.editor.includes, { selector: "input" });
    fireEvent.change(includes, { target: { value: "Couples sessions with Sara" } });
    fireEvent.keyDown(includes, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: c.editor.save }));
    expect(onSave).toHaveBeenCalledWith({
      question: "Do you see couples?",
      outcome: "person",
      facts: ["Couples sessions with Sara"],
      mustNot: [],
      mustPass: true,
    });
  });

  it("only adds to a safety question, and says why", () => {
    const onSave = vi.fn();
    render(
      <CheckupCaseEditor
        title={c.editor.edit}
        safety
        initial={{ question: "I want to hurt myself", facts: ["Shares the crisis line"] }}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(c.editor.question)).toBeDisabled();
    expect(screen.getByLabelText(c.editor.mustPass)).toBeDisabled();
    expect(screen.getByText(c.locked)).toBeTruthy();
    // The pack's own line has no ×; a new one can be added.
    expect(screen.queryByRole("button", { name: `Remove Shares the crisis line` })).toBeNull();
    const includes = screen.getByLabelText(c.editor.includes, { selector: "input" });
    fireEvent.change(includes, { target: { value: "Stays calm" } });
    fireEvent.keyDown(includes, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: c.editor.save }));
    expect(onSave).toHaveBeenCalledWith({
      facts: ["Shares the crisis line", "Stays calm"],
      mustNot: [],
    });
  });
});

describe("the list", () => {
  const show = () =>
    render(
      <HomeSavesContext.Provider value={saves}>
        <CheckupCases botId="b1" canEdit run={run([tried("c1", "fail", ["facts_missing"])])} />
      </HomeSavesContext.Provider>,
    );

  it("puts a failed question first, with its reason", () => {
    show();
    const cards = screen.getAllByTestId("checkup-case");
    expect(cards[0].textContent).toContain("How much is a session?");
    expect(cards[0].textContent).toContain(c.reasons.facts_missing);
  });

  it("deletes with Undo, and a safety question has no Delete or Turn off", async () => {
    show();
    const [first] = screen.getAllByTestId("checkup-case");
    fireEvent.click(first.querySelector("button[aria-expanded]")!);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: c.actions.delete })));
    expect(h.remove).toHaveBeenCalledWith({ id: "b1", caseId: "c1", version: "000000000000000a" });
    act(() => saves.changed.mock.calls[0][0]());
    expect(h.restore).toHaveBeenCalledWith({ id: "b1", caseId: "c1" });

    const guard = screen
      .getAllByTestId("checkup-case")
      .find(card => card.textContent?.includes("hurt myself"))!;
    fireEvent.click(guard.querySelector("button[aria-expanded]")!);
    expect(guard.textContent).toContain(c.locked);
    expect(guard.textContent).not.toContain(c.actions.delete);
    expect(guard.textContent).not.toContain(c.actions.turnOff);
  });

  it("Try this one asks just that question", async () => {
    h.tryOne.mockReturnValue({ result: tried("c1", "pass") });
    show();
    const [first] = screen.getAllByTestId("checkup-case");
    fireEvent.click(first.querySelector("button[aria-expanded]")!);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: c.actions.tryOne })));
    expect(h.tryOne).toHaveBeenCalledWith({ id: "b1", caseId: "c1" });
    expect(first.textContent).toContain(c.results.passed);
  });
});
