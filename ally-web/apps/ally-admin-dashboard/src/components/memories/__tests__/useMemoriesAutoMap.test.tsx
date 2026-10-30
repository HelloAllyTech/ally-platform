import React from "react";

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Controller, useForm, UseFormReturn } from "react-hook-form";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mapMock, toastMock, promptsRef } = vi.hoisted(() => ({
  mapMock: vi.fn(),
  toastMock: { success: vi.fn(), warning: vi.fn() },
  promptsRef: { current: [] as any[] },
}));

vi.mock("@api/baseApi", () => ({
  baseAPI: {
    injectEndpoints: vi.fn(() => ({})),
    reducerPath: "baseAPI",
    reducer: (state = {}) => state,
    middleware: () => (next: any) => (action: any) => next(action),
  },
}));

vi.mock("@api", async importOriginal => ({
  ...((await importOriginal()) as Record<string, unknown>),
  useGetPromptsByTypeQuery: () => ({ data: promptsRef.current }),
  useMapScenarioMemoriesMutation: () => [(body: unknown) => ({ unwrap: () => mapMock(body) })],
}));

vi.mock("sonner", () => ({ toast: toastMock }));

import { MemoriesAutoMap } from "../MemoriesAutoMap";

const PROMPT_3 = "ally_ai_learn_system_main_agent_prompt_working_memory_split";
const STAGE_DIRECTOR = "ally_ai_learn_system_main_agent_prompt_stage_director";

const KS = [
  { id: "ks-1", title: "My job", content: "Works nights", unlocksFromStateId: null },
  { id: "ks-2", title: "My father", content: "He drank", unlocksFromStateId: "s-2" },
];
const STATES = [
  { id: "s-1", name: "Guarded", guidelines: "Short answers", scoreLower: null, scoreUpper: 50 },
  { id: "s-2", name: "Open", guidelines: "Shares", scoreLower: 50, scoreUpper: null },
  { id: "s-3", name: "", guidelines: "", scoreLower: null, scoreUpper: null },
];

let form: UseFormReturn<any>;

/** The picker stand-in: a real RHF Controller, so a pick is a genuine "change". */
const Harness: React.FC<{ defaults: Record<string, unknown> }> = ({ defaults }) => {
  form = useForm({ defaultValues: defaults });
  return (
    <>
      <Controller
        name="selectedMainPromptCode"
        control={form.control}
        render={({ field }) => (
          <select
            aria-label="Skill Version"
            value={field.value ?? ""}
            onChange={event => field.onChange(event.target.value)}
          >
            <option value={PROMPT_3}>#3</option>
            <option value={STAGE_DIRECTOR}>Stage Director</option>
          </select>
        )}
      />
      <MemoriesAutoMap formMethods={form} />
    </>
  );
};

const pick = (code: string) =>
  fireEvent.change(screen.getByLabelText("Skill Version"), { target: { value: code } });

const baseDefaults = (extra: Record<string, unknown> = {}) => ({
  selectedMainPromptCode: PROMPT_3,
  knowledgeSources: KS,
  states: STATES,
  characterProfileText: "Asha, 34, nurse",
  prompt: "You are Asha.",
  title: "Night shift",
  ...extra,
});

describe("Memories auto-map on first switch to a {memories} prompt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    promptsRef.current = [
      { promptCode: PROMPT_3, availableVariables: ["state_x_guidelines"] },
      {
        promptCode: STAGE_DIRECTOR,
        availableVariables: [{ name: "memories" }, "thoughts", "state_x_guidelines"],
      },
    ];
  });

  it("calls the mapping endpoint with the current form values and fills memories", async () => {
    let resolve: (value: unknown) => void = () => undefined;
    mapMock.mockReturnValue(new Promise(r => (resolve = r)));
    render(<Harness defaults={baseDefaults()} />);

    pick(STAGE_DIRECTOR);

    expect(await screen.findByRole("status")).toHaveTextContent(/sorting/i);
    expect(mapMock).toHaveBeenCalledTimes(1);
    expect(mapMock).toHaveBeenCalledWith({
      knowledgeSources: KS.map(k => ({ ...k })),
      // The unnamed card is dropped: it would be dropped on save too.
      states: [
        { id: "s-1", name: "Guarded", guidelines: "Short answers" },
        { id: "s-2", name: "Open", guidelines: "Shares" },
      ],
      characterProfileText: "Asha, 34, nurse",
      roleInstructions: "You are Asha.",
      title: "Night shift",
    });

    await act(async () => {
      resolve({
        memories: [
          { id: "m-1", title: "My job", content: "Works nights" },
          { id: "m-2", title: "My father", content: "He drank", unlocksFromStateId: "s-2" },
          { id: "m-3", title: "Ghost", content: "x", unlocksFromStateId: "not-a-state" },
        ],
      });
    });

    await waitFor(() => expect(form.getValues("memories")).toHaveLength(3));
    expect(form.getValues("memories")).toEqual([
      { id: "m-1", title: "My job", content: "Works nights", unlocksFromStateId: null },
      { id: "m-2", title: "My father", content: "He drank", unlocksFromStateId: "s-2" },
      // A lock naming an unknown state would hide it all session — dropped.
      { id: "m-3", title: "Ghost", content: "x", unlocksFromStateId: null },
    ]);
    expect(form.getValues("knowledgeSources")).toEqual(KS);
    expect(toastMock.success).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("does not call the endpoint when memories are already present", async () => {
    const existing = [{ id: "m-9", title: "Kept", content: "c", unlocksFromStateId: null }];
    render(<Harness defaults={baseDefaults({ memories: existing })} />);

    pick(STAGE_DIRECTOR);

    await act(async () => undefined);
    expect(mapMock).not.toHaveBeenCalled();
    expect(form.getValues("memories")).toEqual(existing);
  });

  it("falls back to copying knowledge sources as they are when mapping fails", async () => {
    mapMock.mockRejectedValue(new Error("500"));
    render(<Harness defaults={baseDefaults()} />);

    pick(STAGE_DIRECTOR);

    await waitFor(() => expect(form.getValues("memories")).toEqual(KS));
    expect(toastMock.warning).toHaveBeenCalledTimes(1);
    expect(toastMock.success).not.toHaveBeenCalled();
  });

  it("switching back and forth keeps both fields and maps only once", async () => {
    mapMock.mockResolvedValue({
      memories: [{ id: "m-1", title: "My job", content: "Works nights" }],
    });
    render(<Harness defaults={baseDefaults()} />);

    pick(STAGE_DIRECTOR);
    await waitFor(() => expect(form.getValues("memories")).toHaveLength(1));
    const mapped = form.getValues("memories");

    pick(PROMPT_3);
    await act(async () => undefined);
    expect(form.getValues("knowledgeSources")).toEqual(KS);
    expect(form.getValues("memories")).toEqual(mapped);

    pick(STAGE_DIRECTOR);
    await act(async () => undefined);
    expect(mapMock).toHaveBeenCalledTimes(1);
    expect(form.getValues("memories")).toEqual(mapped);
    expect(form.getValues("knowledgeSources")).toEqual(KS);
  });

  it("ignores programmatic changes (form load / reset) and prompts without {memories}", async () => {
    render(<Harness defaults={baseDefaults()} />);

    act(() => {
      form.setValue("selectedMainPromptCode", STAGE_DIRECTOR);
    });
    act(() => {
      form.reset({ ...baseDefaults(), selectedMainPromptCode: STAGE_DIRECTOR });
    });
    pick(PROMPT_3);

    await act(async () => undefined);
    expect(mapMock).not.toHaveBeenCalled();
    expect(form.getValues("memories")).toBeUndefined();
  });

  it("does nothing when there are no knowledge sources to map", async () => {
    render(<Harness defaults={baseDefaults({ knowledgeSources: [] })} />);

    pick(STAGE_DIRECTOR);

    await act(async () => undefined);
    expect(mapMock).not.toHaveBeenCalled();
    expect(form.getValues("memories")).toBeUndefined();
  });
});
