import { render, screen, fireEvent, act } from "@testing-library/react";
import { useForm, UseFormReturn } from "react-hook-form";
import { vi, describe, it, expect, beforeEach } from "vitest";

import { BehavioursAndStatesInstruction } from "../BehavioursAndStatesInstruction";

/**
 * The scoring rubric's per-behaviour Score column. Each behaviour is one line,
 * but the form stores rows of up to 5 behaviours that share a category AND a
 * score, so changing a behaviour's score regroups it into a different row.
 */

vi.mock("@api", () => {
  const apiSliceStub = (reducerPath: string) => ({
    reducerPath,
    reducer: (state = {}) => state,
    middleware: () => (next: any) => (action: any) => next(action),
    injectEndpoints: () => ({}),
  });
  return {
    baseAPI: apiSliceStub("baseAPI"),
    evaluatorAPI: apiSliceStub("evaluatorAPI"),
    useGetActiveTooltipsQuery: () => ({ data: [] }),
  };
});

// The real barrels form an @components <-> @constants cycle that only resolves from the app
// entry, so the table, buttons, icons and constants the rubric touches are stubbed here.
// Hoisted so the vi.mock factories below can reach them.
const mocks = vi.hoisted(() => ({
  placeholderLookup: { kind: "loaded", isUsed: true } as { kind: string; isUsed: boolean },
  table: { current: null as any },
  toastError: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { error: mocks.toastError } }));

vi.mock("@components", () => ({
  NotionTable: (props: any) => {
    mocks.table.current = props;
    return <div data-testid="notion-table" />;
  },
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));
vi.mock("@assets", () => ({ Close: () => <svg />, Trash: () => <svg /> }));
vi.mock("@constants", () => ({
  BEHAVIOURS_AND_STATES_INSTRUCTION_TABLE_COLUMNS: [],
  BEHAVIOURS_INSTRUCTION_CATEGORIES: [
    { value: "SHOULD_DO", label: "Helper should do" },
    { value: "SHOULD_NOT_DO", label: "Helper should not do" },
  ],
  BEHAVIOUR_STATES: [],
  FORM_FIELD_IDS: { STATE_NAMES: "stateNames" },
  en: {
    common: { delete: "Delete" },
    simulation: {
      newRow: "New row",
      scoringRubric: "Scoring Rubric",
      behavioursInstruction: "Behaviours Instruction",
      addStateName: "Add state name",
    },
    errors: { maxRowsBehavioursInstruction: "Max rows" },
  },
}));
vi.mock("../../helper-tag", () => ({ HelperTag: () => <div /> }));

// A variant on the score-bounded states model renders the rubric (not the legacy table).
vi.mock("@hooks", () => ({
  useClickOutside: () => undefined,
  useIsPlaceholderUsed: () => mocks.placeholderLookup,
}));

const rows = () => [
  {
    id: "row-do",
    category: "SHOULD_DO",
    behaviors: [
      { id: "b1", name: "Reflects feelings" },
      { id: "b2", name: "Asks open questions" },
    ],
    instructions: [],
    stateInstructions: [],
  },
  {
    id: "row-dont",
    category: "SHOULD_NOT_DO",
    behaviors: [{ id: "b3", name: "Interrupts" }],
    instructions: [],
    stateInstructions: [],
  },
];

let form: UseFormReturn<any>;

const Harness = ({ initial = rows() }: { initial?: any[] }) => {
  const formMethods = useForm<any>({ defaultValues: { behaviorInstructions: initial } });
  form = formMethods;
  formMethods.watch();
  return (
    <BehavioursAndStatesInstruction
      id="behaviorInstructions"
      formMethods={formMethods}
      isMandatory={false}
    />
  );
};

const scoreInput = (name: string) => screen.getByLabelText(`Score for ${name}`) as HTMLInputElement;
const saved = () => form.getValues("behaviorInstructions") as any[];

const type = (name: string, value: string) => {
  const input = scoreInput(name);
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
};

describe("BehavioursAndStatesInstruction score column", () => {
  beforeEach(() => {
    mocks.placeholderLookup = { kind: "loaded", isUsed: true };
  });

  it("renders a Score input per behaviour, showing +10 / -10 when none was authored", () => {
    render(<Harness />);
    expect(scoreInput("Reflects feelings").value).toBe("10");
    expect(scoreInput("Asks open questions").value).toBe("10");
    expect(scoreInput("Interrupts").value).toBe("-10");
  });

  it("shows an authored score as-is, including one a row already carries", () => {
    render(<Harness initial={[{ ...rows()[0], score: 75 }, rows()[1]]} />);
    expect(scoreInput("Reflects feelings").value).toBe("75");
  });

  it("moves only the edited behaviour into its own row when its score differs", () => {
    render(<Harness />);
    type("Reflects feelings", "75");

    const next = saved();
    const edited = next.find(r => r.score === 75);
    expect(edited.behaviors.map((b: any) => b.name)).toEqual(["Reflects feelings"]);
    expect(edited.category).toBe("SHOULD_DO");
    // The sibling keeps the default (no score), so it stays put.
    const sibling = next.find(r => r.id === "row-do");
    expect(sibling.behaviors.map((b: any) => b.name)).toEqual(["Asks open questions"]);
    expect(sibling.score).toBeUndefined();
  });

  it("regroups behaviours that end up with the same score", () => {
    render(<Harness />);
    type("Reflects feelings", "75");
    type("Asks open questions", "75");

    const withScore = saved().filter(r => r.score === 75);
    expect(withScore).toHaveLength(1);
    expect(withScore[0].behaviors).toHaveLength(2);
  });

  it.each([
    ["101", "Between -100 and 100"],
    ["50.5", "Whole numbers only"],
    ["-5", "Should do: 0 to 100"],
  ])("rejects %s for a should-do behaviour and saves nothing", (value, message) => {
    render(<Harness />);
    const before = JSON.stringify(saved());
    type("Reflects feelings", value);

    expect(screen.getByRole("alert").textContent).toBe(message);
    expect(JSON.stringify(saved())).toBe(before);
  });

  it("rejects -101 for a should-not-do behaviour", () => {
    render(<Harness />);
    type("Interrupts", "-101");
    expect(screen.getByRole("alert").textContent).toBe("Between -100 and 100");
    expect(saved().find(r => r.id === "row-dont").score).toBeUndefined();
  });

  it("resets a custom score to the new category default when the category changes", () => {
    render(<Harness initial={[{ ...rows()[0], score: 75 }, rows()[1]]} />);
    const select = document.getElementById("rubric-category-row-do-b1") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "SHOULD_NOT_DO" } });

    expect(scoreInput("Reflects feelings").value).toBe("-10");
    const moved = saved().find(r => r.behaviors.some((b: any) => b.id === "b1"));
    expect(moved.category).toBe("SHOULD_NOT_DO");
    expect(moved.score).toBeUndefined();
  });

  it("Escape restores the last valid score and clears the error", () => {
    render(<Harness />);
    const input = scoreInput("Reflects feelings");
    fireEvent.change(input, { target: { value: "500" } });
    fireEvent.blur(input);
    expect(screen.getByRole("alert")).toBeTruthy();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input.value).toBe("10");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("legacy table (no variant selected) score column", () => {
  beforeEach(() => {
    // No selected variant resolves to the legacy per-state table, which has its own Score cell.
    mocks.placeholderLookup = { kind: "no_selection", isUsed: false };
    mocks.toastError.mockClear();
  });

  const cellScore = (rowId: string) =>
    mocks.table.current.tableData.data.find((r: any) => r.id.value === rowId).score.value;
  const change = (rowId: string, value: any) =>
    act(() => mocks.table.current.onRowChange({ columnId: "score", rowId, value }));

  it("shows each row's effective score, +10 / -10 by default", () => {
    render(<Harness initial={[{ ...rows()[0], score: 75 }, rows()[1]]} />);
    expect(cellScore("row-do")).toBe(75);
    expect(cellScore("row-dont")).toBe(-10);
  });

  it("saves a valid score on the row", () => {
    render(<Harness />);
    change("row-do", 80);
    expect(saved().find(r => r.id === "row-do").score).toBe(80);
    expect(cellScore("row-do")).toBe(80);
  });

  it.each([
    [101, "row-do", "Score: Between -100 and 100"],
    [50.5, "row-do", "Score: Whole numbers only"],
    [-101, "row-dont", "Score: Between -100 and 100"],
    [10, "row-dont", "Score: Should not do: -100 to 0"],
  ])("rejects %p for %s with a message and keeps the last score", (value, rowId, message) => {
    render(<Harness />);
    const before = cellScore(rowId);
    change(rowId, value);
    expect(mocks.toastError).toHaveBeenCalledWith(message);
    expect(saved().find(r => r.id === rowId).score).toBeUndefined();
    expect(cellScore(rowId)).toBe(before);
  });

  it("hands the table fresh cell data after a rejection so the cell snaps back", () => {
    render(<Harness />);
    const rowsBefore = mocks.table.current.tableData.data;
    change("row-do", 500);
    expect(mocks.table.current.tableData.data).not.toBe(rowsBefore);
  });

  it("treats an emptied cell as the category default", () => {
    render(<Harness initial={[{ ...rows()[0], score: 75 }, rows()[1]]} />);
    change("row-do", null);
    expect(saved().find(r => r.id === "row-do").score).toBeUndefined();
    expect(cellScore("row-do")).toBe(10);
  });

  it("drops a score that is invalid for the new category when the category changes", () => {
    render(<Harness initial={[{ ...rows()[0], score: 75 }, rows()[1]]} />);
    act(() =>
      mocks.table.current.onRowChange({
        columnId: "category",
        rowId: "row-do",
        value: "SHOULD_NOT_DO",
      }),
    );
    const row = saved().find(r => r.id === "row-do");
    expect(row.category).toBe("SHOULD_NOT_DO");
    expect(row.score).toBeUndefined();
    expect(cellScore("row-do")).toBe(-10);
  });

  it("keeps a score that is still valid for the new category", () => {
    render(<Harness initial={[{ ...rows()[0], score: 0 }, rows()[1]]} />);
    act(() =>
      mocks.table.current.onRowChange({
        columnId: "category",
        rowId: "row-do",
        value: "SHOULD_NOT_DO",
      }),
    );
    expect(saved().find(r => r.id === "row-do").score).toBe(0);
  });
});
