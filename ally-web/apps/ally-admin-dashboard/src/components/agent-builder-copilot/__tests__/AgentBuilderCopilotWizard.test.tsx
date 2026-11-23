import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { en } from "@constants";

/**
 * The wizard's suggestions: actor ideas on the first step, a recommended mode, and what to review
 * once generation is done. Generation itself is covered in useAgentBuilderGeneration.test.tsx.
 */

const mocks = vi.hoisted(() => ({
  formValues: {} as Record<string, unknown>,
  setValue: vi.fn(),
  start: vi.fn(),
  generation: { phase: "idle", tasks: [] as unknown[], checks: [] as string[] },
  fetchDesign: vi.fn(),
}));

vi.mock("@store", () => ({
  store: { dispatch: vi.fn(), getState: () => ({}), subscribe: vi.fn() },
}));

vi.mock("@ally-ui-mono/ui-shared", () => ({
  AutoExpandableTextarea: ({ value, onChange }: any) => (
    <textarea aria-label="actor" value={value} onChange={e => onChange(e.target.value)} />
  ),
}));

vi.mock("@icons", () => ({ CheckCircle: () => null, FailIcon: () => null }));

vi.mock("react-hook-form", () => ({
  useWatch: ({ name }: { name: string }) => mocks.formValues[name],
}));

vi.mock("../../competency", () => ({ Competency: () => <div>competency picker</div> }));

vi.mock("@api", () => ({
  ROLEPLAY_MODES: ["learning", "practice", "performance", "pre_assessment", "post_assessment"],
  useGetAgentTestCasesQuery: () => ({
    data: { data: [{ id: "g1", title: "Client deflects", tags: [] }] },
    isLoading: false,
  }),
  useLazyGetRoleplayDesignQuery: () => [mocks.fetchDesign, { isFetching: false }],
}));

vi.mock("../useAgentBuilderGeneration", () => ({
  useAgentBuilderGeneration: () => ({
    ...mocks.generation,
    start: mocks.start,
    abort: vi.fn(),
    reset: vi.fn(),
    doneCount: 0,
    appliedCount: 0,
  }),
}));

// eslint-disable-next-line import/first
import { AgentBuilderCopilotWizard } from "../AgentBuilderCopilotWizard";

const form = () =>
  ({
    control: {},
    getValues: (key?: string) => (key ? mocks.formValues[key] : mocks.formValues),
    setValue: mocks.setValue,
  }) as any;

const strings = en.agentBuilderSuggestions;
const modeStrings = en.agentBuilderMode;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.formValues = { competency: { name: "Assessment of Harm & Response Planning" } };
  mocks.generation = { phase: "idle", tasks: [], checks: [] };
  mocks.fetchDesign.mockReturnValue({
    unwrap: () =>
      Promise.resolve({
        mode: "learning",
        states: true,
        settings: {
          experienceMode: "FEEDBACK",
          remindersEnabled: true,
          currentState: true,
          supervisorNotesEnabled: true,
        },
      }),
  });
});

describe("AgentBuilderCopilotWizard suggestions", () => {
  it("offers actor ideas that fill the description, and hides them once there is text", () => {
    render(<AgentBuilderCopilotWizard formMethods={form()} />);
    const idea = strings.ideas[0];
    fireEvent.click(screen.getByText(idea.label));
    expect((screen.getByLabelText("actor") as HTMLTextAreaElement).value).toBe(idea.text);
    expect(screen.queryByTestId("actor-ideas")).toBeNull();
  });

  it("pre-picks the recommended mode with its reason, then applies the chosen one", async () => {
    render(<AgentBuilderCopilotWizard formMethods={form()} />);
    fireEvent.change(screen.getByLabelText("actor"), {
      target: { value: "A cooperative student, the learner's first try" },
    });
    fireEvent.click(screen.getByText("Next"));
    fireEvent.click(screen.getByText("Next"));

    expect(screen.getByTestId("mode-reason").textContent).toContain(modeStrings.reasons.firstTry);
    const learning = screen.getByDisplayValue("learning") as HTMLInputElement;
    expect(learning.checked).toBe(true);
    expect(screen.getByText(modeStrings.recommended)).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByText("Next"));
    });
    expect(mocks.fetchDesign).toHaveBeenCalledWith("learning");
    expect(mocks.setValue).toHaveBeenCalledWith(
      "supervisorNotesEnabled",
      true,
      expect.objectContaining({ shouldDirty: true }),
    );
  });

  it("lists what to review once generation is done", async () => {
    mocks.generation = { phase: "done", tasks: [], checks: [] };
    render(<AgentBuilderCopilotWizard formMethods={form()} />);
    fireEvent.change(screen.getByLabelText("actor"), { target: { value: "Meera calls" } });
    fireEvent.click(screen.getByText("Next"));
    fireEvent.click(screen.getByText("Next"));
    await act(async () => {
      fireEvent.click(screen.getByText("Next"));
    });
    fireEvent.click(screen.getByText("Client deflects"));
    fireEvent.click(screen.getByText("Generate"));

    await waitFor(() => expect(screen.getByTestId("next-steps")).toBeTruthy());
    const text = screen.getByTestId("next-steps").textContent ?? "";
    expect(text).toContain(strings.next.noTitle);
    expect(text).toContain(strings.next.preview);
    expect(mocks.start).toHaveBeenCalledWith(
      expect.objectContaining({ roleplayMode: "learning", includeStates: true }),
    );
  });
});
