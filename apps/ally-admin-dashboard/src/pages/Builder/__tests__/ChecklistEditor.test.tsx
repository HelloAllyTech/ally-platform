import { useState } from "react";

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { BuilderEvalChecklistItem } from "@types";

// Real Carbon throughout: the checklist is a form, and a mocked ui-shared would hide the
// controls' real behaviour. @constants reads off the @components barrel at module-eval time.
vi.mock("@components", () => ({ cellTypes: {} }));

// eslint-disable-next-line import/first
import { en } from "@constants";

// eslint-disable-next-line import/first
import { ChecklistEditor } from "../eval/ChecklistEditor";

const strings = en.builder.eval.checklist;

const seed: BuilderEvalChecklistItem[] = [
  { id: "C1", text: "Reuses Auto-improve", kind: "must" },
  { id: "C2", text: "Plans a new challenger job", kind: "must_not" },
];

/** Holds the draft the way the fixture panel does, and exposes it to assertions. */
const Harness: React.FC<{
  initial?: BuilderEvalChecklistItem[];
  onDraft?: (items: BuilderEvalChecklistItem[]) => void;
}> = ({ initial = seed, onDraft }) => {
  const [items, setItems] = useState(initial);
  return (
    <ChecklistEditor
      items={items}
      onChange={next => {
        setItems(next);
        onDraft?.(next);
      }}
    />
  );
};

describe("ChecklistEditor", () => {
  it("shows each item with its id, kind and text", () => {
    render(<Harness />);

    expect(screen.getByLabelText(strings.textLabel("C1"))).toHaveValue("Reuses Auto-improve");
    expect(screen.getByLabelText(strings.textLabel("C2"))).toHaveValue(
      "Plans a new challenger job",
    );
    expect(screen.getByLabelText(strings.kindLabel("C1"))).toHaveValue("must");
    expect(screen.getByLabelText(strings.kindLabel("C2"))).toHaveValue("must_not");
  });

  it("says what an empty checklist costs, rather than showing nothing", () => {
    render(<Harness initial={[]} />);
    expect(screen.getByText(strings.empty)).toBeInTheDocument();
  });

  it("edits an item's text", () => {
    const onDraft = vi.fn();
    render(<Harness onDraft={onDraft} />);

    fireEvent.change(screen.getByLabelText(strings.textLabel("C1")), {
      target: { value: "Reuses Auto-improve and its approval step" },
    });

    expect(onDraft).toHaveBeenLastCalledWith([
      { id: "C1", text: "Reuses Auto-improve and its approval step", kind: "must" },
      seed[1],
    ]);
  });

  it("switches an item between must and must not", () => {
    const onDraft = vi.fn();
    render(<Harness onDraft={onDraft} />);

    fireEvent.change(screen.getByLabelText(strings.kindLabel("C1")), {
      target: { value: "must_not" },
    });

    expect(onDraft).toHaveBeenLastCalledWith([{ ...seed[0], kind: "must_not" }, seed[1]]);
  });

  it("adds a blank item with the next id", () => {
    const onDraft = vi.fn();
    render(<Harness onDraft={onDraft} />);

    fireEvent.click(screen.getByRole("button", { name: strings.add }));

    expect(onDraft).toHaveBeenLastCalledWith([...seed, { id: "C3", text: "", kind: "must" }]);
    expect(screen.getByLabelText(strings.textLabel("C3"))).toHaveValue("");
  });

  it("removes an item without renumbering the rest", () => {
    const onDraft = vi.fn();
    render(<Harness onDraft={onDraft} />);

    fireEvent.click(screen.getByRole("button", { name: strings.remove("C1") }));

    expect(onDraft).toHaveBeenLastCalledWith([seed[1]]);
    expect(screen.queryByLabelText(strings.textLabel("C1"))).not.toBeInTheDocument();
    // The judge and the simulated admin cite items by id, so C2 stays C2.
    expect(screen.getByLabelText(strings.textLabel("C2"))).toBeInTheDocument();
  });

  it("numbers a new item past the highest id left, never onto one in use", () => {
    const onDraft = vi.fn();
    render(<Harness onDraft={onDraft} />);

    fireEvent.click(screen.getByRole("button", { name: strings.remove("C1") }));
    fireEvent.click(screen.getByRole("button", { name: strings.add }));

    const last = onDraft.mock.calls.at(-1)?.[0] as BuilderEvalChecklistItem[];
    expect(last.map(item => item.id)).toEqual(["C2", "C3"]);
  });

  it("stops adding at the limit and says so", () => {
    const full = Array.from({ length: 40 }, (_, index) => ({
      id: `C${index + 1}`,
      text: `item ${index + 1}`,
      kind: "must" as const,
    }));
    render(<Harness initial={full} />);

    expect(screen.getByRole("button", { name: strings.add })).toBeDisabled();
    expect(screen.getByText(strings.limit(40))).toBeInTheDocument();
  });

  it("locks every control while the panel is saving", () => {
    render(<ChecklistEditor items={seed} onChange={vi.fn()} disabled />);

    expect(screen.getByLabelText(strings.textLabel("C1"))).toBeDisabled();
    expect(screen.getByLabelText(strings.kindLabel("C1"))).toBeDisabled();
    expect(screen.getByRole("button", { name: strings.add })).toBeDisabled();
    expect(within(screen.getByRole("list")).getAllByRole("button")).toHaveLength(2);
  });
});
