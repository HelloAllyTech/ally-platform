import React from "react";

import { fireEvent, render, screen, within } from "@testing-library/react";
import { useForm, UseFormReturn } from "react-hook-form";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { usesMemories, toastMock } = vi.hoisted(() => ({
  usesMemories: { current: true },
  toastMock: { info: vi.fn(), warning: vi.fn() },
}));

vi.mock("@hooks", () => ({
  useIsPlaceholderUsed: (_code: string | undefined, placeholder: string) => ({
    isUsed: placeholder === "memories" ? usesMemories.current : true,
    kind: "loaded",
  }),
  useClickOutside: vi.fn(),
  useDebounce: (fn: any) => fn,
}));

vi.mock("sonner", () => ({ toast: toastMock }));

// Carbon's combobox doesn't open in jsdom; a checkbox per item drives the
// same onChange contract.
vi.mock("@ally-ui-mono/ui-shared", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  FilterableMultiSelect: ({ id, items, selectedItems, onChange }: any) => (
    <div data-testid={id}>
      {items.map((item: { id: string; label: string }) => {
        const checked = selectedItems.some((s: { id: string }) => s.id === item.id);
        return (
          <label key={item.id}>
            <input
              type="checkbox"
              checked={checked}
              onChange={() =>
                onChange({
                  selectedItems: checked
                    ? selectedItems.filter((s: { id: string }) => s.id !== item.id)
                    : [...selectedItems, item],
                })
              }
            />
            {item.label}
          </label>
        );
      })}
    </div>
  ),
}));

// Named states render an Improve button backed by an RTK mutation; not under test here.
vi.mock("../../enhance-button", () => ({ EnhanceButton: () => null }));

vi.mock("@api/baseApi", () => ({
  baseAPI: {
    injectEndpoints: vi.fn(() => ({})),
    reducerPath: "baseAPI",
    reducer: (state = {}) => state,
    middleware: () => (next: any) => (action: any) => next(action),
  },
}));

import { en } from "@constants";

import { StatesEditor } from "../StatesEditor";

const STATES = [
  {
    id: "s-1",
    name: "Guarded",
    guidelines: "",
    scoreLower: null,
    scoreUpper: 30,
    ragEnabled: false,
  },
  { id: "s-2", name: "Warming", guidelines: "", scoreLower: 30, scoreUpper: 60, ragEnabled: false },
  { id: "s-3", name: "Open", guidelines: "", scoreLower: 60, scoreUpper: null, ragEnabled: false },
];
const MEMORIES = [
  { id: "m-1", title: "My job", content: "", unlocksInStateIds: [] },
  { id: "m-2", title: "My father", content: "", unlocksInStateIds: ["s-2"] },
  { id: "m-3", title: "The pills", content: "", unlocksInStateIds: ["s-2", "s-3"] },
];
const KS = [{ id: "k-1", title: "Old doc", content: "", unlocksFromStateId: "s-2" }];

let form: UseFormReturn<any>;
const Harness: React.FC<{ defaults: Record<string, unknown> }> = ({ defaults }) => {
  form = useForm({ defaultValues: defaults });
  return <StatesEditor id="states" label="States" formMethods={form} />;
};

describe("StatesEditor — memories", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usesMemories.current = true;
  });

  it("gives every state a picker showing the memories picked there", () => {
    render(<Harness defaults={{ states: STATES, memories: MEMORIES, knowledgeSources: KS }} />);

    for (const id of ["s-1", "s-2", "s-3"]) {
      expect(screen.getByTestId(`memories-unlock-here-${id}`)).toBeInTheDocument();
    }
    expect(
      within(screen.getByTestId("memories-unlock-here-s-1")).getByText(en.memories.unlockHereLabel),
    ).toBeInTheDocument();
    // Knowledge Sources' line is not shown on this prompt.
    expect(screen.queryByText(en.knowledgeSource.opensUpHere)).not.toBeInTheDocument();
  });

  it("adds a memory to another state without taking it off the first", () => {
    render(<Harness defaults={{ states: STATES, memories: MEMORIES, knowledgeSources: KS }} />);

    const picker = within(screen.getByTestId("state-memories-s-3"));
    expect(picker.getByLabelText("The pills")).toBeChecked();
    expect(picker.getByLabelText("My father")).not.toBeChecked();
    fireEvent.click(picker.getByLabelText("My father"));

    const father = form.getValues("memories").find((m: any) => m.id === "m-2");
    expect(father.unlocksInStateIds).toEqual(["s-2", "s-3"]);
    expect(form.getValues("memories")[0].unlocksInStateIds).toEqual([]);

    // Unticking it in one state leaves the other.
    fireEvent.click(within(screen.getByTestId("state-memories-s-2")).getByLabelText("My father"));
    expect(form.getValues("memories")[1].unlocksInStateIds).toEqual(["s-3"]);
  });

  it("shows today's Knowledge Sources line, not memories, on other prompts", () => {
    usesMemories.current = false;
    render(<Harness defaults={{ states: STATES, memories: MEMORIES, knowledgeSources: KS }} />);

    expect(screen.queryByTestId("memories-unlock-here-s-2")).not.toBeInTheDocument();
    expect(screen.getByText(en.knowledgeSource.opensUpHere)).toBeInTheDocument();
  });

  it("drops a deleted state from memories, moving one left with none to the next state", () => {
    render(<Harness defaults={{ states: STATES, memories: MEMORIES, knowledgeSources: KS }} />);

    fireEvent.click(screen.getAllByLabelText("Remove state")[1]);

    expect(form.getValues("memories").map((m: any) => m.unlocksInStateIds)).toEqual([
      [],
      ["s-3"],
      ["s-3"],
    ]);
    // States are shared, so the other copy's locks follow too.
    expect(form.getValues("knowledgeSources")[0].unlocksFromStateId).toBe("s-3");
    // Only "My father" lost its last state; "The pills" still had Open.
    expect(toastMock.info).toHaveBeenCalledWith(en.memories.locksMovedOnStateRemoval(1, "Open"));
  });

  it("makes a memory available from the start when the only state is deleted", () => {
    render(
      <Harness
        defaults={{
          states: [STATES[0]],
          memories: [{ id: "m-1", title: "My father", content: "", unlocksInStateIds: ["s-1"] }],
        }}
      />,
    );

    fireEvent.click(screen.getByLabelText("Remove state"));

    expect(form.getValues("memories")[0].unlocksInStateIds).toEqual([]);
    expect(form.getValues("knowledgeSources")).toBeUndefined();
    expect(toastMock.warning).toHaveBeenCalledWith(en.memories.locksClearedOnLastStateRemoval(1));
  });
});
