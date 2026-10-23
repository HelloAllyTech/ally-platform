import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CourseBlueprint, CourseCopilotBlueprintResponse } from "@types";

// @constants reads off the @components barrel at module-eval time (see the Builder
// tests), so the barrel is stubbed rather than loaded for real.
vi.mock("@components", () => ({ cellTypes: {} }));

vi.mock("@components/action-confirmation-popup", () => ({
  ActionConfirmationPopup: ({ isOpen, title, description, primaryButton, secondaryButton }: any) =>
    isOpen ? (
      <div role="dialog">
        <p>{title}</p>
        <p>{description}</p>
        <button onClick={primaryButton.onClick}>{primaryButton.label}</button>
        <button onClick={secondaryButton.onClick}>{secondaryButton.label}</button>
      </div>
    ) : null,
}));

// Carbon's own contracts (focus traps, portals) are not what is under test here.
vi.mock("@ally-ui-mono/ui-shared", () => ({
  Button: ({ children, onClick, disabled }: any) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  Tooltip: ({ children }: any) => <>{children}</>,
  ComposedModal: ({ open, children }: any) => (open ? <div role="dialog">{children}</div> : null),
  ModalBody: ({ children }: any) => <div>{children}</div>,
  NumberInput: ({ id, label, value }: any) => (
    <label htmlFor={id}>
      {label}
      <input id={id} defaultValue={value} />
    </label>
  ),
}));

// jsdom cannot drag, so the drag contexts are wrapped to hand the test each one's
// `onDragEnd` — the handler is where the reorder logic lives. Contexts register in
// render order: the section list first, then one per section for its items.
const dnd = vi.hoisted(() => ({ handlers: [] as any[], next: 0 }));
vi.mock("@dnd-kit/core", async importOriginal => {
  const actual = await importOriginal<typeof import("@dnd-kit/core")>();
  const React = await import("react");
  return {
    ...actual,
    DndContext: (props: any) => {
      const id = React.useRef<number | null>(null);
      if (id.current === null) id.current = dnd.next++;
      dnd.handlers[id.current] = props.onDragEnd;
      return React.createElement(actual.DndContext, props);
    },
  };
});

// eslint-disable-next-line import/first
import { BLUEPRINT_SAVE_DEBOUNCE_MS, BlueprintTree, BlueprintTreeProps } from "../BlueprintTree";
// eslint-disable-next-line import/first
import { budget, makeBlueprint } from "./fixtures";

const reply = (
  blueprint: CourseBlueprint,
  version = 4,
  problems: string[] = [],
): CourseCopilotBlueprintResponse => ({
  blueprint,
  version,
  estimate: blueprint.estimate,
  budget: budget(),
  problems,
});

const setup = (overrides: Partial<BlueprintTreeProps> = {}) => {
  const onSave = vi.fn().mockImplementation(async (saved: CourseBlueprint) => reply(saved));
  const onApprove = vi.fn().mockResolvedValue(true);
  const onRaiseBudget = vi.fn().mockResolvedValue(true);
  const props: BlueprintTreeProps = {
    blueprint: makeBlueprint(),
    version: 3,
    problems: [],
    budget: budget(),
    brief: {
      outcomes: { enabling: ["Reflect feelings back", "Ask open questions"] },
      shape: { durationMinutes: 60 },
    },
    editable: true,
    onSave,
    onApprove,
    onRaiseBudget,
    ...overrides,
  };
  const utils = render(<BlueprintTree {...props} />);
  return { ...utils, props, onSave, onApprove, onRaiseBudget };
};

const row = (container: HTMLElement, id: string) =>
  container.querySelector(`[data-item-id="${id}"]`) as HTMLElement;

const advanceDebounce = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(BLUEPRINT_SAVE_DEBOUNCE_MS);
  });
};

const drag = (contextIndex: number, activeId: string, overId: string) =>
  act(() => {
    dnd.handlers[contextIndex]({ active: { id: activeId }, over: { id: overId } });
  });

const itemIds = (saved: CourseBlueprint) =>
  saved.sections.map(section => section.items.map(entry => entry.id));

beforeEach(() => {
  vi.useFakeTimers();
  dnd.handlers.length = 0;
  dnd.next = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("BlueprintTree — editing", () => {
  it("renders the tree: sections, items, objective tags, source badges and completion rules", () => {
    const { container } = setup();

    expect(screen.getByDisplayValue("Foundations")).toBeInTheDocument();
    expect(screen.getByDisplayValue("What listening is")).toBeInTheDocument();
    // O1 is brief.outcomes.enabling[0]; the tag says what it stands for on hover.
    expect(within(row(container, "a")).getByText("O1")).toHaveAttribute(
      "title",
      "Reflect feelings back",
    );
    expect(within(row(container, "q")).getByText("Pass mark 70")).toBeInTheDocument();
    expect(within(row(container, "r")).getByText("From library")).toBeInTheDocument();
    expect(within(row(container, "v")).getByText("Needs a video link")).toBeInTheDocument();
    expect(within(row(container, "a")).getByText("New")).toBeInTheDocument();
  });

  it("changing an item's type resets its spec and source and saves the right blueprint", async () => {
    const { onSave } = setup();

    fireEvent.change(screen.getByLabelText("Change type of Check your understanding"), {
      target: { value: "JOURNAL" },
    });
    expect(onSave).not.toHaveBeenCalled();
    await advanceDebounce();

    expect(onSave).toHaveBeenCalledTimes(1);
    const [saved, version] = onSave.mock.calls[0];
    expect(version).toBe(3);
    expect(saved.sections[0].items[1]).toMatchObject({
      id: "q",
      type: "JOURNAL",
      spec: {},
      source: { kind: "new" },
    });
    expect(saved.sections[0].items[1].completionCriteria).toBeUndefined();
  });

  it("offers only the inline types as switch targets, and locks roleplays", () => {
    const { container } = setup();
    const select = within(row(container, "a")).getByLabelText(/Change type of/);
    expect(within(select).getAllByRole("option").map(o => o.textContent)).toEqual([
      "Article",
      "Quiz",
      "Journal",
      "Annotation",
      "Game",
    ]);
    // A roleplay carries a library reference a type switch would silently drop.
    expect(within(row(container, "r")).queryByLabelText(/Change type of/)).toBeNull();
  });

  it("removing an item saves the tree without it", async () => {
    const { onSave } = setup();

    fireEvent.click(screen.getByRole("button", { name: "Remove What listening is" }));
    await advanceDebounce();

    expect(itemIds(onSave.mock.calls[0][0])).toEqual([["q"], ["r", "v"]]);
  });

  it("moving the last item of a section down carries it into the next section", async () => {
    const { container, onSave } = setup();

    fireEvent.click(
      within(row(container, "q")).getByRole("button", {
        name: "Move to the start of the next section",
      }),
    );
    await advanceDebounce();

    expect(itemIds(onSave.mock.calls[0][0])).toEqual([["a"], ["q", "r", "v"]]);
  });

  it("cannot move the first item of the course up or the last item down", () => {
    const { container } = setup();
    expect(
      within(row(container, "a")).getByRole("button", {
        name: "Move to the end of the previous section",
      }),
    ).toBeDisabled();
    expect(
      within(row(container, "v")).getByRole("button", {
        name: "Move to the start of the next section",
      }),
    ).toBeDisabled();
  });

  it("dragging a section reorders sections", async () => {
    const { onSave } = setup();

    drag(0, "s1", "s2");
    await advanceDebounce();

    expect(onSave.mock.calls[0][0].sections.map((s: any) => s.id)).toEqual(["s2", "s1"]);
  });

  it("dragging an item reorders within its section only", async () => {
    const { onSave } = setup();

    drag(1, "a", "q");
    await advanceDebounce();

    expect(itemIds(onSave.mock.calls[0][0])).toEqual([["q", "a"], ["r", "v"]]);
  });

  it("renames a section and an item inline", async () => {
    const { onSave } = setup();

    fireEvent.change(screen.getByDisplayValue("Foundations"), { target: { value: "Basics" } });
    fireEvent.change(screen.getByDisplayValue("What listening is"), {
      target: { value: "Listening 101" },
    });
    await advanceDebounce();

    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0][0];
    expect(saved.sections[0].title).toBe("Basics");
    expect(saved.sections[0].items[0].title).toBe("Listening 101");
  });

  it("adds an item from the type picker, and a video asks for its link", async () => {
    const { container, onSave } = setup();

    fireEvent.click(within(container.querySelector('[data-section-id="s2"]') as HTMLElement).getByRole("button", { name: "Add item" }));
    fireEvent.click(screen.getByRole("button", { name: "Video" }));

    // Two videos now need a link: the planned one and the one just added.
    expect(screen.getAllByText("Needs a video link")).toHaveLength(2);

    const inputs = screen.getAllByLabelText("Video link");
    fireEvent.change(inputs[inputs.length - 1], { target: { value: "https://youtu.be/xyz" } });
    await advanceDebounce();

    const added = onSave.mock.calls[0][0].sections[1].items[2];
    expect(added).toMatchObject({
      type: "VIDEO",
      source: { kind: "new" },
      spec: { url: "https://youtu.be/xyz", source: "youtube" },
    });
    expect(added.id).toEqual(expect.any(String));
  });

  it("rejects a video link the player cannot play and keeps it out of the draft", async () => {
    const { container, onSave } = setup();

    fireEvent.change(within(row(container, "v")).getByLabelText("Video link"), {
      target: { value: "https://example.com/clip.mp4" },
    });

    expect(screen.getByText(/Use a YouTube, Vimeo or Loom link/)).toBeInTheDocument();
    await advanceDebounce();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("adds a section", async () => {
    const { onSave } = setup();

    fireEvent.click(screen.getByRole("button", { name: "Add section" }));
    await advanceDebounce();

    const saved = onSave.mock.calls[0][0];
    expect(saved.sections).toHaveLength(3);
    expect(saved.sections[2]).toMatchObject({ title: "New section", items: [] });
  });

  it("stops offering new sections at the limit", () => {
    const base = makeBlueprint();
    const blueprint = {
      ...base,
      sections: Array.from({ length: 8 }, (_, index) => ({
        ...base.sections[0],
        id: `s${index}`,
        items: [{ ...base.sections[0].items[0], id: `i${index}` }],
      })),
    };
    setup({ blueprint });
    expect(screen.getByRole("button", { name: "Add section" })).toBeDisabled();
    expect(screen.getByText("A course can have at most 8 sections.")).toBeInTheDocument();
  });

  it("removes an empty section at once but asks before removing one with items", async () => {
    const base = makeBlueprint();
    const { onSave } = setup({
      blueprint: {
        ...base,
        sections: [...base.sections, { id: "s3", title: "Wrap-up", description: "", purpose: "", items: [] }],
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Remove section Wrap-up" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await advanceDebounce();
    expect(onSave.mock.calls[0][0].sections.map((s: any) => s.id)).toEqual(["s1", "s2"]);

    fireEvent.click(screen.getByRole("button", { name: "Remove section Foundations" }));
    expect(screen.getByRole("dialog")).toHaveTextContent('"Foundations" and its 2 items');
    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));
    await advanceDebounce();
    expect(onSave).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Remove section Foundations" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove section" }));
    await advanceDebounce();
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave.mock.calls[1][0].sections.map((s: any) => s.id)).toEqual(["s2"]);
  });
});

describe("BlueprintTree — saving", () => {
  it("batches a burst of edits into one save of the latest draft", async () => {
    const { onSave } = setup();
    const title = screen.getByDisplayValue("What listening is");

    fireEvent.change(title, { target: { value: "L" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BLUEPRINT_SAVE_DEBOUNCE_MS - 100);
    });
    fireEvent.change(title, { target: { value: "Li" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BLUEPRINT_SAVE_DEBOUNCE_MS - 100);
    });
    expect(onSave).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0].sections[0].items[0].title).toBe("Li");
  });

  it("shows Saving… until the reply lands, then Saved", async () => {
    let resolve: (value: CourseCopilotBlueprintResponse) => void = () => undefined;
    const onSave = vi.fn().mockReturnValue(new Promise(r => (resolve = r)));
    setup({ onSave });

    fireEvent.change(screen.getByDisplayValue("What listening is"), { target: { value: "X" } });
    expect(screen.getByText("Saving…")).toBeInTheDocument();
    await advanceDebounce();
    expect(screen.getByText("Saving…")).toBeInTheDocument();

    await act(async () => resolve(reply(makeBlueprint())));
    expect(screen.getByText("Saved")).toBeInTheDocument();
  });

  it("replaces the draft with the server's reply: recomputed estimate and problems", async () => {
    const recomputed = { ...makeBlueprint(), estimate: { ...makeBlueprint().estimate, usd: 9.99 } };
    const onSave = vi
      .fn()
      .mockResolvedValue(reply(recomputed, 4, ['"Practice" is missing a closing reflection.']));
    setup({ onSave });

    fireEvent.change(screen.getByDisplayValue("What listening is"), { target: { value: "X" } });
    await advanceDebounce();

    expect(screen.getByText("$9.99")).toBeInTheDocument();
    expect(screen.getByText('"Practice" is missing a closing reflection.')).toBeInTheDocument();
    // The title the trainer typed is gone: the reply is the source of truth.
    expect(screen.getByDisplayValue("What listening is")).toBeInTheDocument();
  });

  it("saves against the version the reply returned, not the one it started with", async () => {
    const { onSave } = setup();
    const title = screen.getByDisplayValue("What listening is");

    fireEvent.change(title, { target: { value: "A" } });
    await advanceDebounce();
    fireEvent.change(screen.getByDisplayValue("A"), { target: { value: "AB" } });
    await advanceDebounce();

    expect(onSave.mock.calls.map(call => call[1])).toEqual([3, 4]);
  });

  it("keeps a newer edit made while a save was in flight and saves it too", async () => {
    let resolveFirst: (value: CourseCopilotBlueprintResponse) => void = () => undefined;
    const onSave = vi
      .fn()
      .mockReturnValueOnce(new Promise(r => (resolveFirst = r)))
      .mockImplementation(async (saved: CourseBlueprint) => reply(saved, 5));
    setup({ onSave });

    fireEvent.change(screen.getByDisplayValue("What listening is"), { target: { value: "One" } });
    await advanceDebounce();
    expect(onSave).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByDisplayValue("One"), { target: { value: "Two" } });
    await act(async () => resolveFirst(reply(onSave.mock.calls[0][0], 4)));
    await advanceDebounce();

    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave.mock.calls[1][0].sections[0].items[0].title).toBe("Two");
    expect(onSave.mock.calls[1][1]).toBe(4);
    expect(screen.getByDisplayValue("Two")).toBeInTheDocument();
  });

  it("keeps the edit and offers a retry when a save fails", async () => {
    const onSave = vi.fn().mockResolvedValueOnce(null).mockImplementation(async (b: CourseBlueprint) => reply(b));
    setup({ onSave });

    fireEvent.change(screen.getByDisplayValue("What listening is"), { target: { value: "X" } });
    await advanceDebounce();

    expect(screen.getByText("Couldn't save your changes.")).toBeInTheDocument();
    expect(screen.getByDisplayValue("X")).toBeInTheDocument();
    // Approve cannot be pressed on top of an unsaved change.
    expect(screen.getByRole("button", { name: "Approve & build" })).toBeDisabled();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    });
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Saved")).toBeInTheDocument();
  });

  it("sends a pending edit when the pane unmounts inside the debounce window", () => {
    const { unmount, onSave } = setup();

    fireEvent.change(screen.getByDisplayValue("What listening is"), { target: { value: "Quick" } });
    unmount();

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0].sections[0].items[0].title).toBe("Quick");
  });

  it("adopts a new server version and says so when it replaced an unsaved edit", () => {
    const { rerender, props } = setup();

    fireEvent.change(screen.getByDisplayValue("What listening is"), { target: { value: "Mine" } });
    const patched = makeBlueprint();
    patched.sections[0].items[0].title = "Copilot's rewrite";
    rerender(<BlueprintTree {...props} blueprint={patched} version={4} />);

    expect(screen.getByDisplayValue("Copilot's rewrite")).toBeInTheDocument();
    expect(screen.getByText(/The copilot updated the blueprint/)).toBeInTheDocument();
  });

  it("does not let a refetch of the same version eat a half-typed edit", () => {
    const { rerender, props } = setup();

    fireEvent.change(screen.getByDisplayValue("What listening is"), { target: { value: "Mine" } });
    rerender(<BlueprintTree {...props} blueprint={makeBlueprint()} version={3} />);

    expect(screen.getByDisplayValue("Mine")).toBeInTheDocument();
  });
});

describe("BlueprintTree — approving", () => {
  it("approves the version it is showing", async () => {
    const { onApprove } = setup();
    const approve = screen.getByRole("button", { name: "Approve & build" });
    expect(approve).toBeEnabled();

    await act(async () => {
      fireEvent.click(approve);
    });
    expect(onApprove).toHaveBeenCalledWith(3);
  });

  it("is disabled while the server reports problems, and lists them", () => {
    setup({ problems: ['"Watch a real call" needs a video link.'] });

    expect(screen.getByRole("button", { name: "Approve & build" })).toBeDisabled();
    expect(screen.getByText('"Watch a real call" needs a video link.')).toBeInTheDocument();
    expect(screen.getByText("Fix the problems above first.")).toBeInTheDocument();
  });

  it("falls back to its own checks when the server has not reported yet", () => {
    setup({ problems: undefined });

    expect(screen.getByRole("button", { name: "Approve & build" })).toBeDisabled();
    // The fixture's video has no link — visible from the draft alone.
    expect(screen.getByText('"Watch a real call" needs a video link.')).toBeInTheDocument();
  });

  it("is disabled when the estimate is over the remaining budget, and offers a raise", () => {
    const { onRaiseBudget } = setup({
      budget: budget({ ceilingUsd: 10, spentUsd: 9, remainingUsd: 1 }),
    });

    expect(screen.getByRole("button", { name: "Approve & build" })).toBeDisabled();
    expect(screen.getByText(/The estimate \(\$2\.40\) is more than the budget left \(\$1\.00\)/)).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Raise budget" })[0]);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(onRaiseBudget).not.toHaveBeenCalled();
  });

  it("is not over budget when there is no ceiling", () => {
    setup({ budget: budget({ ceilingUsd: 0, spentUsd: 50, remainingUsd: null }) });

    expect(screen.getByRole("button", { name: "Approve & build" })).toBeEnabled();
    expect(screen.getByText("No ceiling")).toBeInTheDocument();
  });

  it("is disabled the moment there is an unsaved edit", () => {
    // A blueprint with nothing else wrong, so the only thing in the way is the pending save.
    const blueprint = makeBlueprint();
    blueprint.sections[1].items[1].source = { kind: "new" };
    setup({ blueprint });
    fireEvent.change(screen.getByDisplayValue("What listening is"), { target: { value: "X" } });

    expect(screen.getByRole("button", { name: "Approve & build" })).toBeDisabled();
    expect(screen.getByText("Saving your changes…")).toBeInTheDocument();
  });

  it("shows totals from the tree and cost against the budget", () => {
    setup({ budget: budget({ remainingUsd: 7.5 }) });

    expect(screen.getByText("33 min")).toBeInTheDocument();
    expect(screen.getByText("of 1 h asked for")).toBeInTheDocument();
    expect(screen.getByText("$2.40")).toBeInTheDocument();
    expect(screen.getByText("$7.50")).toBeInTheDocument();
  });
});

describe("BlueprintTree — when editing is not allowed", () => {
  it("pauses editing while a turn may be patching the same blueprint, and says why", () => {
    setup({ isBusy: true });

    expect(screen.queryByLabelText("Item title")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Remove / })).toBeNull();
    expect(screen.getByText(/editing is paused until it finishes/)).toBeInTheDocument();
    // Approve is still on screen, but cannot be pressed mid-turn.
    expect(screen.getByRole("button", { name: "Approve & build" })).toBeDisabled();
    expect(screen.getByText("The copilot is still replying.")).toBeInTheDocument();
  });

  it("shows an approved blueprint read-only, with no Approve button", () => {
    setup({ editable: false, readOnlyReason: "This is the blueprint you approved." });

    expect(screen.getByText("This is the blueprint you approved.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve & build" })).toBeNull();
    expect(screen.queryByLabelText("Item title")).toBeNull();
    expect(screen.getByText("What listening is")).toBeInTheDocument();
    // Cost is the plan's; "over budget" is meaningless once the money is spent.
    expect(screen.queryByText("Budget left")).toBeNull();
  });

  it("tolerates a section whose items the agent left out", () => {
    const blueprint = {
      ...makeBlueprint(),
      sections: [{ id: "x", title: "Broken", description: "", purpose: "" }],
    } as never;
    setup({ blueprint, problems: undefined });

    expect(screen.getByDisplayValue("Broken")).toBeInTheDocument();
    expect(screen.getByText('"Broken" has no items.')).toBeInTheDocument();
  });
});
