import { fireEvent, render, screen, within } from "@testing-library/react";
import { FormProvider, useForm, useWatch } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";

// Load the constants barrel before @components: they import each other, and in the
// other order a constant is read from @components before it has finished loading.
import "@constants";
import { BranchingScenarioContent, TrackFormValues, TrackItemType } from "@types";

import { BranchingScenarioItemEditor } from "../BranchingScenarioItemEditor";

vi.mock("../../ItemEditorFrame", () => ({
  ItemEditorFrame: ({ children }: any) => <div data-testid="item-editor-frame">{children}</div>,
}));

// React Flow needs layout APIs jsdom doesn't have; the chart is not what these tests cover.
vi.mock("../BranchingFlowCanvas", () => ({
  BranchingFlowCanvas: () => <div data-testid="flow-canvas" />,
}));

vi.mock("../../../../useTrackMediaUpload", () => ({
  useTrackMediaUpload: () => ({ upload: vi.fn(), isUploading: false }),
}));

vi.mock("sonner", () => ({ toast: { info: vi.fn(), error: vi.fn() } }));

vi.mock("@ally-ui-mono/ui-shared", () => ({
  TextArea: ({ labelText, value, onChange, id }: any) => (
    <div>
      <label htmlFor={id}>{labelText}</label>
      <textarea id={id} value={value} onChange={onChange} />
    </div>
  ),
  Tooltip: ({ children }: any) => <div>{children}</div>,
}));

const content = (): BranchingScenarioContent => ({
  settings: { passScore: 0, maxAttempts: null },
  startNodeId: "a",
  nodes: [
    {
      id: "a",
      title: "Start",
      text: "Hello",
      image: { url: "https://cdn.test/a.jpg" },
      choices: [
        { id: "c1", text: "Listen", nextNodeId: "b" },
        { id: "c2", text: "Advise", nextNodeId: "c" },
      ],
    },
    { id: "b", title: "Good", text: "Good" },
    { id: "c", title: "Bad", text: "Bad" },
  ],
});

let current: BranchingScenarioContent | undefined;

const Spy = () => {
  current = useWatch<TrackFormValues>({
    name: "sections.0.items.0.branching",
  }) as BranchingScenarioContent | undefined;
  return null;
};

const Harness = ({ branching }: { branching: BranchingScenarioContent }) => {
  const methods = useForm<TrackFormValues>({
    defaultValues: {
      sections: [
        {
          localId: "s1",
          items: [
            {
              localId: "i1",
              type: TrackItemType.BRANCHING_SCENARIO,
              title: "Scenario",
              branching,
            },
          ],
        },
      ],
    } as any,
  });
  return (
    <FormProvider {...methods}>
      <BranchingScenarioItemEditor sectionIndex={0} itemIndex={0} onDelete={vi.fn()} />
      <Spy />
    </FormProvider>
  );
};

describe("BranchingScenarioItemEditor — experience", () => {
  it("defaults to Classic and stores STORY only when Story is picked", () => {
    render(<Harness branching={content()} />);
    const group = screen.getByRole("radiogroup", { name: /Experience/ });
    const classic = within(group).getByRole("radio", { name: /Classic/ });
    const story = within(group).getByRole("radio", { name: /Story/ });
    expect(classic).toBeChecked();
    expect(story).not.toBeChecked();

    fireEvent.click(story);
    expect(current?.experience).toBe("STORY");
    expect(story).toBeChecked();

    fireEvent.click(classic);
    expect(current && "experience" in current).toBe(false);
  });

  it("warns in Story mode about scenes that will reuse a photo", () => {
    render(<Harness branching={content()} />);
    expect(screen.queryByText(/no photo/)).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: /Story/ }));
    expect(
      screen.getByText(
        "2 of 3 scenes have no photo. In Story mode they'll reuse the photo from the scene before.",
      ),
    ).toBeInTheDocument();
  });
});

describe("BranchingScenarioItemEditor — this scene", () => {
  it("offers three modes and switches a decision to one button", () => {
    render(<Harness branching={content()} />);
    const choose = screen.getByRole("button", { name: "Asks the learner to choose" });
    const oneButton = screen.getByRole("button", { name: "Continues with one button" });
    expect(screen.getByRole("button", { name: "Is an ending" })).toBeInTheDocument();
    expect(choose).toHaveAttribute("aria-pressed", "true");
    // At 2 choices the remove buttons are hidden: going to 1 is the mode switch.
    expect(screen.queryByRole("button", { name: /Remove choice/ })).toBeNull();

    fireEvent.click(oneButton);
    expect(current?.nodes[0].choices).toEqual([{ id: "c1", text: "Listen", nextNodeId: "b" }]);
    expect(oneButton).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText(/^Button text/)).toHaveValue("Listen");
    expect(screen.getByText(/Short and in the learner's voice/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Leads to/)).toHaveValue("b");
    expect(screen.queryByRole("button", { name: "Add choice" })).toBeNull();
    expect(screen.queryByLabelText(/Choice 1 text/)).toBeNull();
  });

  it("switching one button back to choose shows two choices", () => {
    const start = content();
    start.nodes[0].choices = start.nodes[0].choices!.slice(0, 1);
    render(<Harness branching={start} />);
    expect(screen.getByRole("button", { name: "Continues with one button" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "Asks the learner to choose" }));
    expect(current?.nodes[0].choices).toHaveLength(2);
    expect(screen.getByLabelText("Choice 1 text")).toHaveValue("Listen");
    expect(screen.getByLabelText("Choice 2 text")).toHaveValue("");
  });
});
