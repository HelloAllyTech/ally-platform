import React from "react";

import { fireEvent, render, screen } from "@testing-library/react";
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

const { runMapping } = vi.hoisted(() => ({ runMapping: vi.fn() }));
vi.mock("../useMemoriesAutoMap", () => ({
  useMapMemories: () => ({ runMapping, isMapping: false }),
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
  it("renders one row per memory with where it unlocks, in ladder order", () => {
    render(
      <Harness
        defaults={{
          states: STATES,
          memories: [
            { id: "m-1", title: "My job", content: "Nights", unlocksInStateIds: [] },
            {
              id: "m-2",
              title: "My father",
              content: "He drank",
              unlocksInStateIds: ["s-2", "s-1"],
            },
            { id: "m-3", title: "Ghost", content: "", unlocksInStateIds: ["gone"] },
          ],
        }}
      />,
    );

    const rows = screen.getAllByTestId("memory-row");
    expect(rows).toHaveLength(3);
    expect(screen.getByLabelText("Memory 1 title")).toHaveValue("My job");
    expect(screen.getByLabelText("Memory 2 text")).toHaveValue("He drank");
    expect(screen.getAllByTestId("memory-unlocks-at").map(el => el.textContent)).toEqual([
      en.memories.fromTheStart,
      en.memories.unlocksAt("Guarded, Open"),
      en.memories.unlocksAt(en.memories.missingState),
    ]);
    expect(screen.getByText(en.memories.help)).toBeInTheDocument();
  });

  it("edits, adds and removes rows", () => {
    render(
      <Harness
        defaults={{
          states: STATES,
          memories: [{ id: "m-1", title: "My job", content: "Nights", unlocksInStateIds: ["s-1"] }],
        }}
      />,
    );

    fireEvent.change(screen.getByLabelText("Memory 1 title"), { target: { value: "Work" } });
    expect(form.getValues("memories")[0]).toMatchObject({
      title: "Work",
      unlocksInStateIds: ["s-1"],
    });

    fireEvent.click(screen.getByText(en.memories.add));
    expect(form.getValues("memories")).toHaveLength(2);
    expect(form.getValues("memories")[1]).toMatchObject({ title: "", unlocksInStateIds: [] });

    fireEvent.click(screen.getAllByLabelText(en.memories.remove)[0]);
    expect(form.getValues("memories")).toHaveLength(1);
    expect(form.getValues("memories")[0].title).toBe("");
  });

  it("re-maps from knowledge sources only after the author confirms", () => {
    const confirm = vi.spyOn(window, "confirm");
    render(
      <Harness
        defaults={{
          states: STATES,
          knowledgeSources: [{ id: "k-1", title: "Job", content: "" }],
          memories: [{ id: "m-1", title: "Job", content: "", unlocksInStateIds: [] }],
        }}
      />,
    );

    confirm.mockReturnValueOnce(false);
    fireEvent.click(screen.getByTestId("memories-remap"));
    expect(runMapping).not.toHaveBeenCalled();

    confirm.mockReturnValueOnce(true);
    fireEvent.click(screen.getByTestId("memories-remap"));
    expect(runMapping).toHaveBeenCalledWith({ replace: true });
    confirm.mockRestore();
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
