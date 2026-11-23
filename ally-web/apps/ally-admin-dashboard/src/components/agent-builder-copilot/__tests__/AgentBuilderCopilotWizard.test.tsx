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
  goals: {} as Record<string, unknown>,
  suggest: vi.fn(),
  fetchCharacter: vi.fn(),
  catalog: [
    {
      language_id: 1,
      value: "en-IN",
      label: "English (India)",
      voices: [{ id: "v-en", name: "Anushka", gender: "female", provider: "SARVAM" }],
    },
    {
      language_id: 2,
      value: "kn-IN",
      label: "Kannada (India)",
      voices: [{ id: "v-kn", name: "Raju", gender: "male", provider: "ELEVENLABS" }],
    },
  ] as any[],
}));

vi.mock("@store", () => ({
  store: { dispatch: vi.fn(), getState: () => ({}), subscribe: vi.fn() },
}));

vi.mock("@ally-ui-mono/ui-shared", () => ({
  AutoExpandableTextarea: ({ value, onChange, placeholder }: any) => (
    <textarea
      aria-label={String(placeholder).startsWith("Describe") ? "actor" : "chat"}
      value={value}
      onChange={e => onChange(e.target.value)}
    />
  ),
}));

vi.mock("@icons", () => ({ CheckCircle: () => null, FailIcon: () => null }));

vi.mock("react-hook-form", () => ({
  useWatch: ({ name }: { name: string }) => mocks.formValues[name],
}));

vi.mock("../../competency", () => ({ Competency: () => <div>competency picker</div> }));

vi.mock("@api", () => ({
  ROLEPLAY_MODES: ["learning", "practice", "performance", "pre_assessment", "post_assessment"],
  useGetAgentTestCasesQuery: () => mocks.goals,
  useGetAvailableLanguageVoicesQuery: () => ({ data: mocks.catalog }),
  useLazyGetRoleplayDesignQuery: () => [mocks.fetchDesign, { isFetching: false }],
  useSuggestAgentBuilderCharactersMutation: () => [mocks.suggest, { isLoading: false }],
  useLazyGetCharacterByIdQuery: () => [mocks.fetchCharacter, { isFetching: false }],
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
  mocks.goals = {
    data: { data: [{ id: "g1", title: "Client deflects", tags: [] }] },
    isLoading: false,
    isError: false,
  };
  mocks.suggest.mockReturnValue({
    unwrap: () =>
      Promise.resolve({ characters: [], recommendedId: null, reason: null, searchFailed: false }),
  });
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
    await act(async () => {
      fireEvent.click(screen.getByText("Next"));
    });
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

  it("goes on without test cases when they can't be listed", async () => {
    mocks.goals = { data: undefined, isLoading: false, isError: true };
    render(<AgentBuilderCopilotWizard formMethods={form()} />);
    fireEvent.change(screen.getByLabelText("actor"), { target: { value: "Meera calls" } });
    fireEvent.click(screen.getByText("Next"));
    fireEvent.click(screen.getByText("Next"));
    await act(async () => {
      fireEvent.click(screen.getByText("Next"));
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Next"));
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Next"));
    });
    expect(screen.getByText(modeStrings.goalsUnavailable)).toBeTruthy();
    fireEvent.click(screen.getByText("Generate"));
    expect(mocks.start).toHaveBeenCalledWith(expect.objectContaining({ agentTestCases: "" }));
  });
});

describe("AgentBuilderCopilotWizard saved conversation", () => {
  const saved = {
    version: 1,
    history: [
      { question: "Describe roleplay actor", answer: "Aarav, 15" },
      { question: "Choose the roleplay's mode", answer: "Learning mode: reminders." },
    ],
    description: "Aarav, 15",
    mode: "learning",
    states: true,
    goalIds: ["g1"],
    result: { applied: 12, total: 14, stopped: false, checks: ["remindersHidden"] },
    generatedAt: "2026-11-23T10:00:00.000Z",
  };

  beforeEach(() => {
    mocks.goals = { data: { data: [] }, isLoading: false, isError: false };
  });

  it("shows the earlier conversation when a roleplay is reopened", () => {
    mocks.formValues.agentBuilderChat = saved;
    render(<AgentBuilderCopilotWizard formMethods={form()} />);

    expect(screen.getByTestId("restored-chat").textContent).toContain("12 of 14 fields");
    expect(screen.getByText("Aarav, 15")).toBeTruthy();
    expect(screen.getByText(en.agentBuilderMode.remindersHidden)).toBeTruthy();
    expect(screen.getByTestId("next-steps")).toBeTruthy();
    expect(screen.queryByTestId("actor-ideas")).toBeNull();

    fireEvent.click(screen.getByText(en.agentBuilderRestored.startOver));
    expect((screen.getByLabelText("actor") as HTMLTextAreaElement).value).toBe("Aarav, 15");
  });

  it("saves the conversation on the form when generation finishes", () => {
    mocks.generation = { phase: "done", tasks: [{}, {}], checks: [] };
    render(<AgentBuilderCopilotWizard formMethods={form()} />);

    const call = mocks.setValue.mock.calls.find(([field]) => field === "agentBuilderChat");
    expect(call?.[1]).toMatchObject({ version: 1, result: { total: 2, stopped: false } });
    expect(call?.[2]).toMatchObject({ shouldDirty: true });
  });
});

describe("AgentBuilderCopilotWizard casting from the Character Library", () => {
  const characterStrings = en.agentBuilderCharacter;

  const toCharacterStep = async () => {
    render(<AgentBuilderCopilotWizard formMethods={form()} />);
    fireEvent.change(screen.getByLabelText("actor"), {
      target: { value: "A 52-year-old farmer near Mandya" },
    });
    fireEvent.click(screen.getByText("Next"));
    fireEvent.click(screen.getByText("Next"));
    await act(async () => {
      fireEvent.click(screen.getByText("Next"));
    });
  };

  it("pre-picks the fit check's character and fills the form from it", async () => {
    mocks.suggest.mockReturnValue({
      unwrap: () =>
        Promise.resolve({
          characters: [
            {
              id: "c-1",
              name: "Gowramma",
              summary: "52, female, farmer",
              hasVoices: true,
              profileExcerpt: "Grew up in Mandya",
            },
            { id: "c-2", name: "Lakshmamma", summary: "", hasVoices: false, profileExcerpt: "" },
          ],
          recommendedId: "c-1",
          reason: "She can speak from the setting.",
          searchFailed: false,
        }),
    });
    mocks.fetchCharacter.mockReturnValue({
      unwrap: () =>
        Promise.resolve({
          id: "c-1",
          name: "Gowramma",
          age: 52,
          gender: "female",
          characterProfileText: "Grew up in Mandya.",
        }),
    });
    await toCharacterStep();

    expect(mocks.suggest).toHaveBeenCalledWith(
      expect.objectContaining({ description: "A 52-year-old farmer near Mandya" }),
    );
    expect((screen.getByDisplayValue("c-1") as HTMLInputElement).checked).toBe(true);
    expect(screen.getByTestId("character-note").textContent).toContain(
      "She can speak from the setting.",
    );
    expect(screen.getByText(characterStrings.noVoices)).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByText("Next"));
    });
    expect(mocks.setValue).toHaveBeenCalledWith("characterProfileSelector", "c-1");
    expect(mocks.setValue).toHaveBeenCalledWith("name", "Gowramma", expect.anything());

    await act(async () => {
      fireEvent.click(screen.getByText("Next"));
    });
    fireEvent.click(screen.getByText("Client deflects"));
    fireEvent.click(screen.getByText("Generate"));
    const inputs = mocks.start.mock.calls[0][0];
    expect(inputs.libraryCharacter).toBe(true);
    expect(inputs.actorDescription).toContain(characterStrings.briefNote("Gowramma"));
    expect(inputs.actorDescription).toContain("Grew up in Mandya.");
  });

  it("writes a new character when the library can't be searched", async () => {
    mocks.suggest.mockReturnValue({ unwrap: () => Promise.reject(new Error("down")) });
    await toCharacterStep();

    expect(screen.getByTestId("character-note").textContent).toBe(characterStrings.searchFailed);
    expect((screen.getByDisplayValue("new") as HTMLInputElement).checked).toBe(true);
    await act(async () => {
      fireEvent.click(screen.getByText("Next"));
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Next"));
    });
    fireEvent.click(screen.getByText("Client deflects"));
    fireEvent.click(screen.getByText("Generate"));
    expect(mocks.start.mock.calls[0][0].libraryCharacter).toBeUndefined();
    expect(mocks.fetchCharacter).not.toHaveBeenCalled();
  });
});

describe("AgentBuilderCopilotWizard chat box", () => {
  const chat = en.agentBuilderChatBox;

  const send = async (text: string) => {
    fireEvent.change(screen.getByLabelText("chat"), { target: { value: text } });
    await act(async () => {
      fireEvent.click(screen.getByText(chat.send));
    });
  };

  const toModeStep = () => {
    render(<AgentBuilderCopilotWizard formMethods={form()} />);
    fireEvent.change(screen.getByLabelText("actor"), { target: { value: "Meera calls" } });
    fireEvent.click(screen.getByText("Next"));
    fireEvent.click(screen.getByText("Next"));
  };

  it("is not shown on the first step, which is already free text", () => {
    render(<AgentBuilderCopilotWizard formMethods={form()} />);
    expect(screen.queryByTestId("agent-chat-box")).toBeNull();
  });

  it("re-picks the mode from a note, and shows the note in the chat", async () => {
    toModeStep();
    expect((screen.getByDisplayValue("practice") as HTMLInputElement).checked).toBe(true);

    await send("This is the final check before certification");

    expect(screen.getByText("This is the final check before certification")).toBeTruthy();
    expect((screen.getByDisplayValue("post_assessment") as HTMLInputElement).checked).toBe(true);
  });

  it("searches the library again with the note on the client step", async () => {
    toModeStep();
    await act(async () => {
      fireEvent.click(screen.getByText("Next"));
    });
    expect(mocks.suggest).toHaveBeenCalledTimes(1);

    await send("an older woman who speaks Kannada");

    expect(mocks.suggest).toHaveBeenCalledTimes(2);
    expect(mocks.suggest.mock.calls[1][0].description).toContain(
      "an older woman who speaks Kannada",
    );
  });

  it("puts every note on the brief, and offers to generate again after a new one", async () => {
    toModeStep();
    await send("No mention of family");
    await act(async () => {
      fireEvent.click(screen.getByText("Next"));
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Next"));
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Next"));
    });
    fireEvent.click(screen.getByText("Client deflects"));
    fireEvent.click(screen.getByText("Generate"));

    expect(mocks.start.mock.calls[0][0].actorDescription).toContain(chat.briefNotes);
    expect(mocks.start.mock.calls[0][0].actorDescription).toContain("- No mention of family");

    await send("Make her more guarded");
    fireEvent.click(screen.getByText(chat.regenerate));
    expect(mocks.start).toHaveBeenCalledTimes(2);
    expect(mocks.start.mock.calls[1][0].actorDescription).toContain("- Make her more guarded");
    expect(mocks.start.mock.calls[1][0].agentTestCases).toBe("Client deflects");
  });
});

describe("AgentBuilderCopilotWizard languages and voices", () => {
  const strings = en.agentBuilderLanguages;

  const toLanguagesStep = async () => {
    render(<AgentBuilderCopilotWizard formMethods={form()} />);
    fireEvent.change(screen.getByLabelText("actor"), { target: { value: "Meera calls" } });
    fireEvent.click(screen.getByText("Next"));
    fireEvent.click(screen.getByText("Next"));
    await act(async () => {
      fireEvent.click(screen.getByText("Next"));
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Next"));
    });
  };

  const generate = async () => {
    await act(async () => {
      fireEvent.click(screen.getByText("Next"));
    });
    fireEvent.click(screen.getByText("Client deflects"));
    fireEvent.click(screen.getByText("Generate"));
  };

  it("decides from the description by default", async () => {
    await toLanguagesStep();
    expect((screen.getByDisplayValue("describe") as HTMLInputElement).checked).toBe(true);
    await generate();
    expect(mocks.start.mock.calls[0][0].languages).toBeUndefined();
  });

  it("uses the chosen languages, puts a chosen voice on the form and leaves the rest to the agent", async () => {
    await toLanguagesStep();
    fireEvent.click(screen.getByDisplayValue("choose"));
    fireEvent.click(screen.getByLabelText("English (India)"));
    fireEvent.click(screen.getByLabelText("Kannada (India)"));
    fireEvent.change(screen.getByLabelText(strings.voiceFor("Kannada (India)")), {
      target: { value: "v-kn" },
    });
    await generate();

    expect(mocks.setValue).toHaveBeenCalledWith(
      "languageVoices",
      { "2": "v-kn" },
      expect.objectContaining({ shouldDirty: true }),
    );
    expect(mocks.start.mock.calls[0][0].languages).toEqual([
      { languageId: "1", label: "English (India)", code: "en-IN" },
      { languageId: "2", label: "Kannada (India)", code: "kn-IN" },
    ]);
    expect(
      screen.getByText(`English (India): ${strings.agentPicks}; Kannada (India): Raju`),
    ).toBeTruthy();
  });

  it("asks for at least one language when choosing", async () => {
    await toLanguagesStep();
    fireEvent.click(screen.getByDisplayValue("choose"));
    fireEvent.click(screen.getByText("Next"));
    expect(screen.getByText(strings.pickOne)).toBeTruthy();
  });

  it("pre-selects nothing, even when voices are already on the form", async () => {
    mocks.formValues.languageVoices = { "2": "v-kn" };
    await toLanguagesStep();
    expect((screen.getByDisplayValue("describe") as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByDisplayValue("choose"));
    expect((screen.getByLabelText("English (India)") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText("Kannada (India)") as HTMLInputElement).checked).toBe(false);
  });
});

describe("AgentBuilderCopilotWizard layout", () => {
  it("shows where the trainer is in the six steps", () => {
    render(<AgentBuilderCopilotWizard formMethods={form()} />);
    expect(screen.getByTestId("step-tracker").textContent).toContain("Step 1 of 6");
    fireEvent.change(screen.getByLabelText("actor"), { target: { value: "Meera calls" } });
    fireEvent.click(screen.getByText("Next"));
    expect(screen.getByTestId("step-tracker").textContent).toContain("Step 2 of 6");
  });

  it("in focus layout, titles the tab and offers the form", () => {
    const onShowForm = vi.fn();
    render(
      <AgentBuilderCopilotWizard formMethods={form()} layout="focus" onShowForm={onShowForm} />,
    );
    expect(screen.getByText(en.agentBuilderWizard.title)).toBeTruthy();
    fireEvent.click(screen.getByText(en.agentBuilderWizard.showForm));
    expect(onShowForm).toHaveBeenCalled();
  });

  it("tells the page when generation starts, so the form can come in", async () => {
    const onGenerationStart = vi.fn();
    render(
      <AgentBuilderCopilotWizard
        formMethods={form()}
        layout="focus"
        onGenerationStart={onGenerationStart}
      />,
    );
    fireEvent.change(screen.getByLabelText("actor"), { target: { value: "Meera calls" } });
    fireEvent.click(screen.getByText("Next"));
    fireEvent.click(screen.getByText("Next"));
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        fireEvent.click(screen.getByText("Next"));
      });
    }
    fireEvent.click(screen.getByText("Client deflects"));
    fireEvent.click(screen.getByText("Generate"));
    expect(onGenerationStart).toHaveBeenCalledTimes(1);
  });
});
