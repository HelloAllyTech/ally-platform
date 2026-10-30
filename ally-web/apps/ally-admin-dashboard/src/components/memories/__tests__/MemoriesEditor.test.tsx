import React from "react";

import { fireEvent, render, screen, within } from "@testing-library/react";
import { useForm, UseFormReturn } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";

vi.mock("@api/baseApi", () => ({
  baseAPI: {
    injectEndpoints: vi.fn(() => ({})),
    reducerPath: "baseAPI",
    reducer: (state = {}) => state,
    middleware: () => (next: any) => (action: any) => next(action),
  },
}));

import { en, MEMORIES_SIZE_WARNING_CHARS } from "@constants";

import { MemoriesEditor } from "../MemoriesEditor";

const STATES = [
  { id: "s-2", name: "Open", guidelines: "", scoreLower: 50, scoreUpper: null, ragEnabled: false },
  {
    id: "s-1",
    name: "Guarded",
    guidelines: "",
    scoreLower: null,
    scoreUpper: 50,
    ragEnabled: false,
  },
];

let form: UseFormReturn<any>;
const Harness: React.FC<{ defaults: Record<string, unknown> }> = ({ defaults }) => {
  form = useForm({ defaultValues: defaults });
  return <MemoriesEditor id="memories" label="Memories" formMethods={form} />;
};

describe("MemoriesEditor", () => {
  it("renders one row per memory with an Available-from select in ladder order", () => {
    render(
      <Harness
        defaults={{
          states: STATES,
          memories: [
            { id: "m-1", title: "My job", content: "Nights", unlocksFromStateId: null },
            { id: "m-2", title: "My father", content: "He drank", unlocksFromStateId: "s-2" },
          ],
        }}
      />,
    );

    const rows = screen.getAllByTestId("memory-row");
    expect(rows).toHaveLength(2);
    expect(screen.getByLabelText("Memory 1 title")).toHaveValue("My job");
    expect(screen.getByLabelText("Memory 2 text")).toHaveValue("He drank");

    const select = within(rows[1]).getByLabelText(en.memories.availableFrom) as HTMLSelectElement;
    expect(select.value).toBe("s-2");
    expect(Array.from(select.options).map(o => o.textContent)).toEqual([
      en.memories.fromTheStart,
      "Guarded",
      "Open",
    ]);
    expect(screen.getByText(en.memories.help)).toBeInTheDocument();
  });

  it("edits, assigns a state, adds and removes rows", () => {
    render(
      <Harness
        defaults={{
          states: STATES,
          memories: [{ id: "m-1", title: "My job", content: "Nights", unlocksFromStateId: null }],
        }}
      />,
    );

    fireEvent.change(screen.getByLabelText("Memory 1 title"), { target: { value: "Work" } });
    fireEvent.change(screen.getByLabelText(en.memories.availableFrom), {
      target: { value: "s-1" },
    });
    expect(form.getValues("memories")[0]).toMatchObject({
      title: "Work",
      unlocksFromStateId: "s-1",
    });

    fireEvent.change(screen.getByLabelText(en.memories.availableFrom), { target: { value: "" } });
    expect(form.getValues("memories")[0].unlocksFromStateId).toBeNull();

    fireEvent.click(screen.getByText(en.memories.add));
    expect(form.getValues("memories")).toHaveLength(2);
    expect(form.getValues("memories")[1]).toMatchObject({ title: "", unlocksFromStateId: null });

    fireEvent.click(screen.getAllByLabelText(en.memories.remove)[0]);
    expect(form.getValues("memories")).toHaveLength(1);
    expect(form.getValues("memories")[0].title).toBe("");
  });

  it("shows the empty state when there are no memories", () => {
    render(<Harness defaults={{ states: STATES }} />);
    expect(screen.getByText(en.memories.empty)).toBeInTheDocument();
  });

  it("warns, without blocking, when backstory + memories pass the size limit", () => {
    const half = Math.ceil(MEMORIES_SIZE_WARNING_CHARS / 2);
    const { unmount } = render(
      <Harness
        defaults={{
          characterProfileText: "a".repeat(half),
          memories: [{ id: "m-1", title: "t", content: "b".repeat(half - 10) }],
        }}
      />,
    );
    expect(screen.queryByTestId("memories-size-warning")).not.toBeInTheDocument();
    unmount();

    render(
      <Harness
        defaults={{
          characterProfileText: "a".repeat(half),
          memories: [{ id: "m-1", title: "t", content: "b".repeat(half) }],
        }}
      />,
    );
    expect(screen.getByTestId("memories-size-warning")).toBeInTheDocument();
    expect(screen.getByText(en.memories.add)).toBeInTheDocument();
  });
});
