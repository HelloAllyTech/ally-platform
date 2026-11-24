import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { UseFormReturn } from "react-hook-form";

import { useAgentBuilderGeneration } from "../useAgentBuilderGeneration";

/**
 * The wizard's orchestration is the part unit tests of the parsers can't reach:
 * generation is CHAINED (challenge description + persona first, then every other
 * field with them as context), two further calls are SEQUENCED (spoken_languages decides the language fan-out;
 * language_voices waits on persona), and a Stop has to cancel calls that didn't
 * exist when it was pressed. These cover that shape.
 */

const CATALOG_FOR_MOCK = [
  {
    language_id: 1,
    value: "en-IN",
    label: "English (India)",
    translationCode: "en",
    voices: [{ id: "en-f", name: "Anushka", provider: "SARVAM", gender: "female", age: "adult" }],
  },
  {
    language_id: 2,
    value: "hi-IN",
    label: "Hindi (India)",
    translationCode: "hi",
    voices: [{ id: "hi-m", name: "Raju", provider: "ELEVENLABS", gender: "male", age: null }],
  },
];

/**
 * Mocked module state lives in `vi.hoisted` because the `vi.mock` factories are
 * hoisted above the file's own consts.
 *
 * Neither factory spreads `importOriginal()`: `@api` and `@hooks` are barrels
 * that reach `@store`, which reads `baseAPI.reducerPath` at module load — with
 * `@api` mid-mock that is undefined, and the suite either fails to load or
 * deadlocks. The real `useResolvedPrimaryLanguageId` is pulled in by path
 * instead, so the primary-language split is the genuine one.
 */
const mocks = vi.hoisted(() => {
  /** Per-field canned responses; each `trigger` resolves from here. */
  /**
   * `holds` lets a test keep one field's call in flight until it releases it,
   * to observe what the chain does while a foundation field is still running.
   */
  const state: {
    responses: Record<string, unknown>;
    failing: Set<string>;
    holds: Record<string, Promise<void>>;
  } = {
    responses: {},
    failing: new Set<string>(),
    holds: {},
  };
  const requests: Array<Record<string, unknown>> = [];
  const aborts = vi.fn();
  const trigger = vi.fn((body: Record<string, unknown>) => {
    requests.push(body);
    const field = String(body.field);
    return {
      abort: aborts,
      unwrap: () =>
        (state.holds[field] ?? Promise.resolve()).then(() =>
          state.failing.has(field)
            ? Promise.reject({ data: { message: "boom" } })
            : { value: state.responses[field] },
        ),
    };
  });
  const cover = {
    start: vi.fn(() => ({
      abort: vi.fn(),
      unwrap: () =>
        Promise.resolve({ jobId: "job-1", status: "succeeded", imageUrl: "https://img/fast.png" }),
    })),
    poll: vi.fn(() => ({
      unwrap: () =>
        Promise.resolve({ jobId: "job-1", status: "succeeded", imageUrl: "https://img/cover.png" }),
    })),
  };
  const translate = vi.fn((body: { targets: { languageId: string }[] }) => ({
    abort: vi.fn(),
    unwrap: () =>
      Promise.resolve({
        translations: Object.fromEntries(
          body.targets.map(t => [t.languageId, `translated ${t.languageId}`]),
        ),
      }),
  }));
  return { state, requests, aborts, trigger, cover, translate };
});

const { state, requests, aborts, trigger } = mocks;

vi.mock("@api", () => ({
  useGenerateAgentBuilderFieldMutation: () => [mocks.trigger],
  useStartCoverImageJobMutation: () => [mocks.cover.start],
  useLazyGetCoverImageJobQuery: () => [mocks.cover.poll],
  useTranslateForAgentBuilderMutation: () => [mocks.translate],
  useGetAvailableLanguageVoicesQuery: () => ({ data: CATALOG_FOR_MOCK, isLoading: false }),
}));

// `agentBuilderApply` reaches `@store` through the `@constants` barrel, and
// `@store` reads `baseAPI.reducerPath` at module load — undefined while `@api`
// is mocked. Nothing here dispatches, so a stub store keeps that module out of
// the graph entirely.
vi.mock("@store", () => ({
  store: { dispatch: vi.fn(), getState: () => ({}), subscribe: vi.fn() },
}));

vi.mock("@hooks", async () => ({
  // The states field is gated on the selected main prompt; keep it out so the
  // plan under test is just the language behaviour.
  useIsPlaceholderUsed: () => ({ isUsed: false }),
  useResolvedPrimaryLanguageId: (await import("../../../hooks/useResolvedPrimaryLanguageId"))
    .useResolvedPrimaryLanguageId,
}));

const makeForm = (values: Record<string, unknown> = {}) => {
  const store: Record<string, unknown> = { ...values };
  const setValue = vi.fn((key: string, next: unknown) => {
    store[key] = next;
  });
  return {
    store,
    setValue,
    form: {
      setValue,
      getValues: (key?: string) => (key ? store[key] : store),
      watch: (key: string) => store[key],
      trigger: vi.fn().mockResolvedValue(true),
    } as unknown as UseFormReturn<any>,
  };
};

const INPUTS = {
  actorDescription: "Suchi speaks English and Hindi.",
  competency: "Active listening",
  agentTestCases: "Client deflects",
};

const fieldsRequested = () => requests.map(r => String(r.field));

beforeEach(() => {
  requests.length = 0;
  aborts.mockClear();
  trigger.mockClear();
  state.failing = new Set();
  state.holds = {};
  state.responses = {
    role_instruction: "Be guarded.",
    title: "A tired daughter-in-law",
    challenge_description: "She minimises.",
    persona: { name: "Suchi", age: 34, gender: "female" },
    backstory: "Moved from Tamil Nadu.",
    knowledge_sources: [{ title: "Dementia basics", content: "…" }],
    reminders: "Slow down",
    spoken_languages: [
      { languageId: "1", label: "English (India)", code: "en" },
      { languageId: "2", label: "Hindi (India)", code: "hi" },
    ],
    opening_statements: "I just want some information.",
    linguistic_style_samples: ["I'm managing fine."],
    allowed_filler_words: ["um", "I mean"],
    language_voices: [
      {
        languageId: "1",
        languageLabel: "English (India)",
        voiceId: "en-f",
        voiceName: "Anushka",
        voiceGender: "female",
      },
    ],
  };
});

describe("useAgentBuilderGeneration", () => {
  it("fans the language-scoped fields out once per spoken language", async () => {
    const { form } = makeForm();
    const { result } = renderHook(() => useAgentBuilderGeneration(form));

    act(() => result.current.start(INPUTS));
    await waitFor(() => expect(result.current.phase).toBe("done"));

    const requested = fieldsRequested();
    // One detection call, then three fields x two languages.
    expect(requested.filter(f => f === "spoken_languages")).toHaveLength(1);
    for (const field of [
      "opening_statements",
      "linguistic_style_samples",
      "allowed_filler_words",
    ]) {
      const perField = requests.filter(r => r.field === field);
      expect(perField.map(r => r.languageId).sort()).toEqual(["1", "2"]);
    }
    // Every per-language row is labelled with its language.
    expect(result.current.tasks.map(t => t.label)).toContain(
      "Linguistic style samples (Hindi (India))",
    );
    expect(result.current.tasks.find(t => t.field === "spoken_languages")?.label).toBe(
      "Languages the client speaks: English (India), Hindi (India)",
    );
  });

  it("writes each language into its own tab, English on the primary field", async () => {
    const { form, store } = makeForm();
    const { result } = renderHook(() => useAgentBuilderGeneration(form));

    act(() => result.current.start(INPUTS));
    await waitFor(() => expect(result.current.phase).toBe("done"));

    expect(store.openingStatements).toBe("I just want some information.");
    expect(store.translationOpeningStatements).toEqual({
      "2": ["I just want some information."],
    });
    expect(store.linguisticStyleSamples).toEqual({
      "1": ["I'm managing fine."],
      "2": ["I'm managing fine."],
    });
    expect(store.allowedFillerWords).toEqual({
      "1": ["um", "I mean"],
      "2": ["um", "I mean"],
    });
  });

  it("casts voices for the spoken languages and reports what it picked", async () => {
    const { form, store } = makeForm();
    const { result } = renderHook(() => useAgentBuilderGeneration(form));

    act(() => result.current.start(INPUTS));
    await waitFor(() => expect(result.current.phase).toBe("done"));

    const castRequest = requests.find(r => r.field === "language_voices");
    // Cast after the persona, so it knows who it is voicing.
    expect(castRequest).toMatchObject({ personaGender: "female", personaAge: 34 });
    expect(castRequest?.languageIds).toEqual(["1", "2"]);

    // Hindi wasn't cast by the model, so the deterministic picker filled it —
    // and the summary says both which voice and that it's a fallback.
    expect(store.languageVoices).toEqual({ "1": "en-f", "2": "hi-m" });
    const voiceTask = result.current.tasks.find(t => t.key === "language_voices");
    expect(voiceTask?.status).toBe("done");
    expect(voiceTask?.label).toBe(
      "Language–Voice mapping: English (India) → Anushka, " +
        "Hindi (India) → Raju (no female voice, default pick)",
    );
  });

  it("never moves a voice the trainer already chose", async () => {
    const { form, store } = makeForm({ languageVoices: { "1": "trainer-pick" } });
    const { result } = renderHook(() => useAgentBuilderGeneration(form));

    act(() => result.current.start(INPUTS));
    await waitFor(() => expect(result.current.phase).toBe("done"));

    expect(requests.find(r => r.field === "language_voices")?.languageIds).toEqual(["2"]);
    expect((store.languageVoices as Record<string, string>)["1"]).toBe("trainer-pick");
  });

  it("falls back to the picker when the cast call fails", async () => {
    state.failing = new Set(["language_voices"]);
    const { form, store } = makeForm();
    const { result } = renderHook(() => useAgentBuilderGeneration(form));

    act(() => result.current.start(INPUTS));
    await waitFor(() => expect(result.current.phase).toBe("done"));

    // Mandatory to publish, so a failed cast must still leave a usable mapping.
    expect(store.languageVoices).toEqual({ "1": "en-f", "2": "hi-m" });
    expect(result.current.tasks.find(t => t.key === "language_voices")?.status).toBe("done");
  });

  it("marks a failed field without stopping the rest of the batch", async () => {
    state.failing = new Set(["title"]);
    const { form, store } = makeForm();
    const { result } = renderHook(() => useAgentBuilderGeneration(form));

    act(() => result.current.start(INPUTS));
    await waitFor(() => expect(result.current.phase).toBe("done"));

    expect(result.current.tasks.find(t => t.field === "title")?.status).toBe("error");
    expect(store.linguisticStyleSamples).toBeDefined();
  });

  it("generates nothing per-language when detection returns no languages", async () => {
    state.responses.spoken_languages = [];
    const { form, store } = makeForm();
    const { result } = renderHook(() => useAgentBuilderGeneration(form));

    act(() => result.current.start(INPUTS));
    await waitFor(() => expect(result.current.phase).toBe("done"));

    expect(fieldsRequested()).not.toContain("linguistic_style_samples");
    expect(fieldsRequested()).not.toContain("language_voices");
    expect(store.languageVoices).toBeUndefined();
    expect(result.current.tasks.find(t => t.field === "spoken_languages")?.status).toBe("empty");
  });

  it("aborts every in-flight call, including ones the fan-out added later", async () => {
    const { form } = makeForm();
    const { result } = renderHook(() => useAgentBuilderGeneration(form));

    act(() => result.current.start(INPUTS));
    // Let the fan-out be scheduled before stopping, so the later handles exist.
    await waitFor(() => expect(fieldsRequested()).toContain("linguistic_style_samples"));
    act(() => result.current.abort());

    expect(result.current.phase).toBe("aborted");
    // One abort per request made, the per-language ones included.
    expect(aborts).toHaveBeenCalledTimes(requests.length);
  });
});

describe("useAgentBuilderGeneration — chained stages", () => {
  const STAGE_ONE = ["challenge_description", "persona", "spoken_languages"];

  it("sends every later field what the foundation established", async () => {
    const { form } = makeForm();
    const { result } = renderHook(() => useAgentBuilderGeneration(form));

    act(() => result.current.start(INPUTS));
    await waitFor(() => expect(result.current.phase).toBe("done"));

    const expected = {
      challengeDescription: "She minimises.",
      persona: { name: "Suchi", age: 34, gender: "female" },
    };
    const later = requests.filter(r => !STAGE_ONE.includes(String(r.field)));
    // Title, role instruction, backstory, knowledge sources, reminders, the
    // per-language rows and the voice cast all build on the same client.
    expect(later.map(r => r.field)).toEqual(
      expect.arrayContaining(["title", "backstory", "opening_statements", "language_voices"]),
    );
    for (const request of later) {
      expect(request.establishedContext).toEqual(expected);
    }
    for (const request of requests.filter(
      r => String(r.field) !== "challenge_description" && STAGE_ONE.includes(String(r.field)),
    )) {
      expect(request.establishedContext).toBeUndefined();
    }
  });

  it("holds later fields as waiting until the foundation lands", async () => {
    let releasePersona = () => {};
    state.holds.persona = new Promise<void>(resolve => {
      releasePersona = resolve;
    });
    const { form } = makeForm();
    const { result } = renderHook(() => useAgentBuilderGeneration(form));

    act(() => result.current.start(INPUTS));
    // With `persona` held, `challenge_description` (which now depends on it)
    // should remain "active", while `spoken_languages` (also stage one, but
    // independent) should finish.
    await waitFor(() =>
      expect(result.current.tasks.find(t => t.field === "spoken_languages")?.status).toBe("done"),
    );
    expect(result.current.tasks.find(t => t.field === "challenge_description")?.status).toBe(
      "active",
    );

    expect(fieldsRequested()).not.toContain("title");
    expect(result.current.tasks.find(t => t.field === "title")?.status).toBe("waiting");
    // Waiting rows don't count towards progress.
    expect(result.current.doneCount).toBeLessThan(result.current.tasks.length);

    act(() => releasePersona());
    await waitFor(() => expect(result.current.phase).toBe("done"));
    expect(fieldsRequested()).toContain("title");
  });

  it("still runs the later fields when a foundation field fails, with what did land", async () => {
    state.failing = new Set(["persona"]);
    const { form } = makeForm();
    const { result } = renderHook(() => useAgentBuilderGeneration(form));

    act(() => result.current.start(INPUTS));
    await waitFor(() => expect(result.current.phase).toBe("done"));

    const backstory = requests.find(r => r.field === "backstory");
    expect(backstory?.establishedContext).toEqual({ challengeDescription: "She minimises." });
    expect(result.current.tasks.find(t => t.field === "backstory")?.status).toBe("done");
  });

  it("sends the generated persona as context to challenge description generation", async () => {
    const { form } = makeForm();
    const { result } = renderHook(() => useAgentBuilderGeneration(form));

    act(() => result.current.start(INPUTS));
    await waitFor(() => expect(result.current.phase).toBe("done"));

    const personaRequest = requests.find(r => r.field === "persona");
    const challengeRequest = requests.find(r => r.field === "challenge_description");

    // Persona is called with no context
    expect(personaRequest?.establishedContext).toBeUndefined();

    // Challenge description is called with persona context. The `challengeDescription`
    // is undefined because it has not been generated yet.
    expect(challengeRequest?.establishedContext).toEqual({
      persona: { name: "Suchi", age: 34, gender: "female" },
      challengeDescription: undefined,
    });
  });

  it("never fires the waiting fields when stopped during the foundation", async () => {
    state.holds.persona = new Promise<void>(() => {});
    const { form } = makeForm();
    const { result } = renderHook(() => useAgentBuilderGeneration(form));

    act(() => result.current.start(INPUTS));
    await waitFor(() => expect(fieldsRequested()).toContain("persona"));
    act(() => result.current.abort());

    expect(result.current.phase).toBe("aborted");
    expect(result.current.tasks.find(t => t.field === "title")?.status).toBe("aborted");
    await Promise.resolve();
    expect(fieldsRequested()).not.toContain("title");
  });
});

describe("useAgentBuilderGeneration — roleplay mode", () => {
  it("asks for states laid out for the mode, even before the prompt lookup says states", async () => {
    const { form } = makeForm();
    const { result } = renderHook(() => useAgentBuilderGeneration(form));

    act(() => result.current.start({ ...INPUTS, roleplayMode: "learning", includeStates: true }));
    await waitFor(() => expect(result.current.phase).toBe("done"));

    const states = requests.find(r => r.field === "states");
    expect(states).toMatchObject({ roleplayMode: "learning" });
    // The mode rides only on the states call.
    expect(requests.find(r => r.field === "title")?.roleplayMode).toBeUndefined();
  });

  it("switches reminders off when the mode turned them on and none were written", async () => {
    state.responses.reminders = "";
    const { form, store } = makeForm({ remindersEnabled: true });
    const { result } = renderHook(() => useAgentBuilderGeneration(form));

    act(() => result.current.start({ ...INPUTS, roleplayMode: "practice" }));
    await waitFor(() => expect(result.current.phase).toBe("done"));

    expect(store.remindersEnabled).toBe(false);
    expect(result.current.checks).toEqual(["remindersHidden"]);
  });

  it("leaves reminders alone without a mode", async () => {
    state.responses.reminders = "";
    const { form, store } = makeForm({ remindersEnabled: true });
    const { result } = renderHook(() => useAgentBuilderGeneration(form));

    act(() => result.current.start(INPUTS));
    await waitFor(() => expect(result.current.phase).toBe("done"));

    expect(store.remindersEnabled).toBe(true);
    expect(result.current.checks).toEqual([]);
    expect(fieldsRequested()).not.toContain("states");
  });

  it("keeps a library character's persona and backstory instead of generating them", async () => {
    const { form } = makeForm({ name: "Gowramma", age: 52, gender: "female" });
    const { result } = renderHook(() => useAgentBuilderGeneration(form));

    act(() => result.current.start({ ...INPUTS, libraryCharacter: true }));
    await waitFor(() => expect(result.current.phase).toBe("done"));

    expect(fieldsRequested()).not.toContain("persona");
    expect(fieldsRequested()).not.toContain("backstory");
    expect(requests.find(r => r.field === "title")?.establishedContext).toMatchObject({
      persona: { name: "Gowramma", age: 52, gender: "female" },
    });
  });

  describe("cover image", () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      mocks.cover.start.mockClear();
      mocks.cover.poll.mockClear();
    });
    afterEach(() => vi.useRealTimers());

    it("generates a cover from the title and persona once they are in, polling the job", async () => {
      mocks.cover.start.mockReturnValueOnce({
        abort: vi.fn(),
        unwrap: () => Promise.resolve({ jobId: "job-1", status: "running" }),
      } as any);
      const { form, store } = makeForm();
      const { result } = renderHook(() => useAgentBuilderGeneration(form));

      act(() => result.current.start(INPUTS));
      await waitFor(() => expect(mocks.cover.start).toHaveBeenCalled());
      expect(mocks.cover.start.mock.calls[0][0]).toMatchObject({
        title: "A tired daughter-in-law",
        name: "Suchi",
        age: 34,
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3500);
      });
      await waitFor(() => expect(result.current.phase).toBe("done"));
      expect(mocks.cover.poll).toHaveBeenCalledWith("job-1");
      expect(store.coverImageUrl).toBe("https://img/cover.png");
      expect(result.current.tasks.find(t => t.key === "cover_image")?.status).toBe("done");
    });

    it("keeps a cover that is already on the form", async () => {
      const { form, store } = makeForm({ coverImageUrl: "https://img/mine.png" });
      const { result } = renderHook(() => useAgentBuilderGeneration(form));

      act(() => result.current.start(INPUTS));
      await waitFor(() => expect(result.current.phase).toBe("done"));
      expect(mocks.cover.start).not.toHaveBeenCalled();
      expect(store.coverImageUrl).toBe("https://img/mine.png");
    });

    it("notes a refused cover without failing the batch", async () => {
      mocks.cover.start.mockReturnValueOnce({
        abort: vi.fn(),
        unwrap: () => Promise.reject({ status: 403 }),
      } as any);
      const { form } = makeForm();
      const { result } = renderHook(() => useAgentBuilderGeneration(form));

      act(() => result.current.start(INPUTS));
      await waitFor(() => expect(result.current.phase).toBe("done"));
      expect(result.current.tasks.find(t => t.key === "cover_image")).toMatchObject({
        status: "error",
        error: "you don't have permission to generate cover images",
      });
      expect(result.current.tasks.find(t => t.field === "title")?.status).toBe("done");
    });

    it("skips the cover when asked", async () => {
      const { form } = makeForm();
      const { result } = renderHook(() => useAgentBuilderGeneration(form));
      act(() => result.current.start({ ...INPUTS, generateCover: false }));
      await waitFor(() => expect(result.current.phase).toBe("done"));
      expect(result.current.tasks.some(t => t.key === "cover_image")).toBe(false);
    });
  });

  it("uses the trainer's languages instead of detecting them", async () => {
    const { form } = makeForm();
    const { result } = renderHook(() => useAgentBuilderGeneration(form));

    act(() =>
      result.current.start({
        ...INPUTS,
        generateCover: false,
        languages: [{ languageId: "2", label: "Hindi (India)", code: "hi" }],
      }),
    );
    await waitFor(() => expect(result.current.phase).toBe("done"));

    expect(fieldsRequested()).not.toContain("spoken_languages");
    expect(requests.filter(r => r.field === "opening_statements").map(r => r.languageId)).toEqual([
      "2",
    ]);
    expect(result.current.tasks.find(t => t.field === "spoken_languages")?.label).toBe(
      "Languages you chose: Hindi (India)",
    );
  });

  it("translates the challenge description into the other voiced languages, last", async () => {
    mocks.translate.mockClear();
    const { form, store } = makeForm();
    const { result } = renderHook(() => useAgentBuilderGeneration(form));

    act(() => result.current.start({ ...INPUTS, generateCover: false }));
    await waitFor(() => expect(result.current.phase).toBe("done"));

    // The title, the description and the reminders, each into the other selected languages.
    expect(mocks.translate).toHaveBeenCalledTimes(3);
    expect(mocks.translate.mock.calls.map(c => c[0].text)).toEqual([
      "A tired daughter-in-law",
      "She minimises.",
      "Slow down",
    ]);
    expect(store.translationTitle).toEqual({ "2": "translated 2" });
    expect(store.translationReminders).toEqual({ "2": "translated 2" });
    expect(requests.find(r => r.field === "reminders")?.languageId).toBe("1");
    const body = mocks.translate.mock.calls[0][0];
    // Hindi got a voice in this batch; English is the main language and is not translated.
    expect(body.targets).toEqual([{ languageId: "2", languageCode: "hi-IN" }]);
    expect(store.translationDescription).toEqual({ "2": "translated 2" });
    expect(
      result.current.tasks.find(t => t.key === "challenge_description_translations")?.status,
    ).toBe("done");
  });

  it("keeps the roleplay to the selected languages only", async () => {
    mocks.translate.mockClear();
    // A roleplay that starts with voices and leftovers for languages nobody chose.
    const { form, store } = makeForm({
      languageVoices: { "1": "en-f", "2": "hi-m", "7": "ta-f", "9": "ml-m" },
      translationDescription: { "7": "old Tamil text" },
      linguisticStyleSamples: { "9": ["old Malayalam"] },
    });
    const { result } = renderHook(() => useAgentBuilderGeneration(form));

    act(() =>
      result.current.start({
        ...INPUTS,
        generateCover: false,
        languages: [{ languageId: "2", label: "Hindi (India)", code: "hi" }],
      }),
    );
    await waitFor(() => expect(result.current.phase).toBe("done"));

    // Only Hindi is playable; English stays as the main (base) tab's language.
    expect(Object.keys(store.languageVoices as object)).toEqual(["2"]);
    expect(store.translationDescription).toEqual({ "2": "translated 2" });
    expect(Object.keys(store.linguisticStyleSamples as object)).toEqual(["2"]);
    expect(
      mocks.translate.mock.calls.every(
        c => c[0].targets.map((t: any) => t.languageId).join() === "2",
      ),
    ).toBe(true);
  });
});
