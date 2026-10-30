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
  { id: "m-1", title: "My job", content: "", unlocksFromStateId: null },
  { id: "m-2", title: "My father", content: "", unlocksFromStateId: "s-2" },
  { id: "m-3", title: "The pills", content: "", unlocksFromStateId: "s-2" },
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

  it("lists, read-only, the memories that unlock at each state on a {memories} prompt", () => {
    render(<Harness defaults={{ states: STATES, memories: MEMORIES, knowledgeSources: KS }} />);

    const list = screen.getByTestId("memories-unlock-here-s-2");
    expect(within(list).getByText(en.memories.unlockHere)).toBeInTheDocument();
    expect(
      within(list)
        .getAllByRole("listitem")
        .map(li => li.textContent),
    ).toEqual(["My father", "The pills"]);
    expect(screen.queryByTestId("memories-unlock-here-s-1")).not.toBeInTheDocument();
    // Knowledge Sources' line is not shown on this prompt.
    expect(screen.queryByText(en.knowledgeSource.opensUpHere)).not.toBeInTheDocument();
  });

  it("shows today's Knowledge Sources line, not memories, on other prompts", () => {
    usesMemories.current = false;
    render(<Harness defaults={{ states: STATES, memories: MEMORIES, knowledgeSources: KS }} />);

    expect(screen.queryByTestId("memories-unlock-here-s-2")).not.toBeInTheDocument();
    expect(screen.getByText(en.knowledgeSource.opensUpHere)).toBeInTheDocument();
  });

  it("moves memory locks to the next state when their state is deleted", () => {
    render(<Harness defaults={{ states: STATES, memories: MEMORIES, knowledgeSources: KS }} />);

    fireEvent.click(screen.getAllByLabelText("Remove state")[1]);

    expect(form.getValues("memories").map((m: any) => m.unlocksFromStateId)).toEqual([
      null,
      "s-3",
      "s-3",
    ]);
    // States are shared, so the other copy's locks follow too.
    expect(form.getValues("knowledgeSources")[0].unlocksFromStateId).toBe("s-3");
    expect(toastMock.info).toHaveBeenCalledWith(en.memories.locksMovedOnStateRemoval(2, "Open"));
  });

  it("clears memory locks when the only state is deleted", () => {
    render(
      <Harness
        defaults={{
          states: [STATES[0]],
          memories: [{ id: "m-1", title: "My father", content: "", unlocksFromStateId: "s-1" }],
        }}
      />,
    );

    fireEvent.click(screen.getByLabelText("Remove state"));

    expect(form.getValues("memories")[0].unlocksFromStateId).toBeNull();
    expect(form.getValues("knowledgeSources")).toBeUndefined();
    expect(toastMock.warning).toHaveBeenCalledWith(en.memories.locksClearedOnLastStateRemoval(1));
  });
});
