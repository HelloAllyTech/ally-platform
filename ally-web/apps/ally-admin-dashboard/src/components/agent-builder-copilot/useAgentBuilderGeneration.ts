import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { UseFormReturn } from "react-hook-form";

import {
  AgentBuilderEstablishedContext,
  AgentBuilderField,
  AgentBuilderSpokenLanguage,
  RoleplayMode,
  useGenerateAgentBuilderFieldMutation,
  useLazyGetCoverImageJobQuery,
  useStartCoverImageJobMutation,
  useTranslateForAgentBuilderMutation,
  useGetAvailableLanguageVoicesQuery,
} from "@api";
import type { LanguageOption } from "@components/linguistic-style-samples/scenarioLanguageUtils";
import { useIsPlaceholderUsed, useResolvedPrimaryLanguageId } from "@hooks";
// Imported by module rather than through the `@utils` barrel: the barrel
// reaches `loggerWithRedux` -> `@store`, which reads `baseAPI.reducerPath` at
// module load. Pulling that in here drags the whole Redux store into anything
// that renders this hook (its own test included, where the store initializes
// against a mocked `@api` and deadlocks).
import { applyAgentBuilderField, readEstablishedContext } from "@utils/agentBuilderApply";
import {
  describeVoicePicks,
  pickVoicesForLanguages,
  toCastPicks,
} from "@utils/agentBuilderVoicePick";

/**
 * Drives Agent Builder Copilot's chained field generation.
 *
 * On `start`, it runs in TWO STAGES so the fields describe one coherent
 * scenario rather than each inventing its own client. Stage one — the
 * challenge description and persona — is generated from the brief alone. Once
 * both have settled, stage two fires every other field in parallel with that
 * pair attached as `establishedContext`: the backstory is the history of the
 * person the persona named, the states and role instruction play out the
 * challenge the description set, the title names that scenario. Within a
 * stage, one LLM call per field runs concurrently (via the abortable RTK
 * mutation trigger), and each result is written into the shared form as soon
 * as it returns, so Basic Settings still fills in live. Stage-two rows show as
 * "waiting" until the foundation lands, so the pause reads as a dependency
 * rather than a stall.
 * `abort` cancels every in-flight request natively (`.abort()`), stops applying
 * results, and marks the remaining tasks aborted.
 *
 * Three of the fields exist once PER LANGUAGE the client speaks (opening
 * dialogues, linguistic style samples, filler words). They can't be fired up
 * front because the language list comes from the brief, so the batch has one
 * dependent step: the `spoken_languages` call runs alongside the language-
 * agnostic fields and, as soon as it answers, appends and fires that field ×
 * language fan-out. The detected languages are named in the feed rather than
 * inferred silently, and every generated language ends up in a tab the trainer
 * can correct ("Status Communication in Asynchronous Agent Design").
 *
 * The same language list also fills the Language–Voice mapping, once the
 * persona call has landed to say who is being voiced: generated Hindi content
 * is unreachable at runtime until Hindi has a voice, and publish is blocked
 * until it does. That row is its own `language_voices` call — the model reads
 * the brief and the persona and casts a voice per language — with the local
 * picker order as the fallback for anything it doesn't answer for.
 *
 * Writes during the stream skip validation to avoid tripping the parent's 10s
 * autosave + mandatory-field revalidation on every field; one `trigger()` runs
 * after the batch settles.
 */

/** `waiting` = a stage-two row queued behind the foundation fields. */
export type GenerationTaskStatus = "waiting" | "active" | "done" | "empty" | "error" | "aborted";

export interface GenerationTask {
  /**
   * Unique per row: `field`, `field:languageId` for the per-language rows, or a
   * plain id for a row that isn't an LLM call at all (the voice mapping).
   */
  key: string;
  /** Absent on rows that don't call a field generator. */
  field?: AgentBuilderField;
  /** Set on the per-language rows only. */
  languageId?: string;
  /** Human label shown in the chat feed. */
  label: string;
  status: GenerationTaskStatus;
  error?: string;
}

export type GenerationPhase = "idle" | "running" | "done" | "aborted";

export interface GenerationInputs {
  actorDescription: string;
  competency?: string;
  agentTestCases?: string;
  /**
   * The mode picked in the wizard. The server lays the states out for it, and after the batch a
   * check repairs what the mode's settings and the generated fields disagree on.
   */
  roleplayMode?: RoleplayMode;
  /**
   * Generate states even if the form's main prompt hasn't been read as state-aware yet: the
   * mode has just set one, and the placeholder lookup is asynchronous.
   */
  includeStates?: boolean;
  /**
   * A Character Library character is already on the form: its persona and backstory are kept,
   * not generated, and every other field is written from them.
   */
  libraryCharacter?: boolean;
  /**
   * Generate a cover image once the title, challenge and persona are in (default on). A cover
   * already on the form (the trainer's, or a library character's) is kept.
   */
  generateCover?: boolean;
  /**
   * The languages the trainer chose in the wizard. Given, they replace detecting the languages
   * from the brief; voices already on the form for them are kept, and only the rest are cast.
   */
  languages?: AgentBuilderSpokenLanguage[];
  /**
   * The states are already on the form (an approved interview plan): they are not generated
   * again, so the roleplay keeps the states the trainer approved.
   */
  statesOnForm?: boolean;
}

/** The challenge description's other language tabs, translated once the batch is in. */
const TRANSLATE_TASK = {
  key: "challenge_description_translations",
  label: "Challenge description and reminders in other languages",
};

/** The cover row: not a field generator, an image job (start, then poll until it settles). */
const COVER_TASK = { key: "cover_image", label: "Cover image" };
const COVER_POLL_MS = 3000;
/** Image generation can take a minute or two; past this the row gives up, the job may still land. */
const COVER_MAX_WAIT_MS = 4 * 60 * 1000;

const plainText = (value: unknown, max: number): string =>
  String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** The fields a library character supplies itself. */
const CHARACTER_FIELDS: ReadonlySet<AgentBuilderField> = new Set<AgentBuilderField>([
  "persona",
  "backstory",
]);

/**
 * The language-agnostic fields, in the order shown in the feed. `states` is
 * appended conditionally (see STATES_FIELD) and the per-language rows are
 * appended once the languages are known.
 */
const BASE_FIELD_PLAN: { field: AgentBuilderField; label: string }[] = [
  { field: "challenge_description", label: "Challenge description" },
  { field: "persona", label: "Persona (name, age, gender, profession, location)" },
  { field: "title", label: "Title" },
  { field: "role_instruction", label: "Role instruction" },
  { field: "backstory", label: "Character backstory" },
  { field: "knowledge_sources", label: "Knowledge sources" },
  { field: "reminders", label: "Reminders" },
];

/**
 * The fields generated once per spoken language, in the order shown under each
 * language in the feed. Mirrors the server's language-scoped field set.
 */
const LANGUAGE_FIELD_PLAN: { field: AgentBuilderField; label: string }[] = [
  { field: "opening_statements", label: "Opening dialogues" },
  { field: "linguistic_style_samples", label: "Linguistic style samples" },
  { field: "allowed_filler_words", label: "Allowed filler words" },
];

/**
 * Reads the actor brief and answers which of the platform's languages the
 * client speaks. Not a Basic Settings field — it only gates the fan-out above,
 * so it sits last in the feed, immediately before the rows it creates.
 */
const SPOKEN_LANGUAGES_FIELD: { field: AgentBuilderField; label: string } = {
  field: "spoken_languages",
  label: "Languages the client speaks",
};

/**
 * Cast a voice per spoken language. Sequenced after `spoken_languages` (which
 * languages) and `persona` (who is being voiced), so it can't join the initial
 * parallel batch.
 */
const LANGUAGE_VOICES_TASK: { key: string; field: AgentBuilderField; label: string } = {
  key: "language_voices",
  field: "language_voices",
  label: "Language–Voice mapping",
};

/**
 * The `states` field is only generated when the selected main-agent prompt
 * actually uses states (its body references `{state_x_guidelines}`) — the same
 * gate that decides whether the StatesEditor is shown. For any other variant
 * the generated states would be inert and hidden, so we skip the call entirely
 * rather than write metadata the trainer can't see.
 */
const STATES_FIELD: { field: AgentBuilderField; label: string } = {
  field: "states",
  label: "States",
};

/**
 * Stage one of the chain. Mirrors the server's FOUNDATION_AGENT_BUILDER_FIELDS.
 * Kept to the two short fields everything else most needs to agree with: stage
 * two waits for the slower of them, so each addition here is latency on the
 * whole batch.
 */
const FOUNDATION_FIELDS: ReadonlySet<AgentBuilderField> = new Set<AgentBuilderField>([
  "challenge_description",
  "persona",
]);

/**
 * Runs alongside stage one because it reads the brief alone — but the
 * per-language rows it creates are stage-two fields and wait like the rest.
 */
const isStageOne = (field: AgentBuilderField): boolean =>
  FOUNDATION_FIELDS.has(field) || field === "spoken_languages";

const DEFAULT_KNOWLEDGE_SOURCES = 3;

const errorMessage = (err: unknown): string => {
  const anyErr = err as { data?: { message?: string }; error?: string; message?: string };
  return anyErr?.data?.message || anyErr?.error || anyErr?.message || "Generation failed";
};

/** Defensive read of the `spoken_languages` value. */
const toSpokenLanguages = (value: unknown): AgentBuilderSpokenLanguage[] =>
  (Array.isArray(value) ? (value as AgentBuilderSpokenLanguage[]) : []).filter(
    l => typeof l?.languageId === "string" && l.languageId.trim().length > 0,
  );

/**
 * After a batch with a mode: repair what the mode's settings and the generated fields disagree on
 * (the same rule as the roleplay agent's validator in ally-be). Reminders switched on with none
 * written would show the learner an empty panel, so they are switched off. Returns the keys of
 * what changed, for the feed.
 */
export const checkAgainstMode = (formMethods: UseFormReturn<any>): string[] => {
  const changed: string[] = [];
  const reminders = formMethods.getValues("reminders");
  const hasReminders = Array.isArray(reminders)
    ? reminders.length > 0
    : typeof reminders === "string" && reminders.trim().length > 0;
  if (formMethods.getValues("remindersEnabled") && !hasReminders) {
    formMethods.setValue("remindersEnabled", false, { shouldDirty: true, shouldValidate: false });
    changed.push("remindersHidden");
  }
  return changed;
};

export const useAgentBuilderGeneration = (formMethods: UseFormReturn<any>) => {
  const [trigger] = useGenerateAgentBuilderFieldMutation();
  const [startCoverJob] = useStartCoverImageJobMutation();
  const [pollCoverJob] = useLazyGetCoverImageJobQuery();
  const [translateField] = useTranslateForAgentBuilderMutation();
  const [phase, setPhase] = useState<GenerationPhase>("idle");
  const [tasks, setTasks] = useState<GenerationTask[]>([]);
  // What the post-batch check changed, in words, for the feed.
  const [checks, setChecks] = useState<string[]>([]);

  // Include `states` in the fan-out only when the currently-selected main-agent
  // prompt uses states — mirrors the StatesEditor's own visibility gate so we
  // never generate states the trainer can't see or use.
  const selectedMainPromptCode = formMethods.watch("selectedMainPromptCode") as string | undefined;
  const { isUsed: statesPromptSelected } = useIsPlaceholderUsed(
    selectedMainPromptCode,
    "state_x_guidelines",
  );
  const fieldPlan = useMemo(
    () => [
      ...BASE_FIELD_PLAN,
      ...(statesPromptSelected ? [STATES_FIELD] : []),
      SPOKEN_LANGUAGES_FIELD,
    ],
    [statesPromptSelected],
  );

  // Which language owns `openingStatements` (vs `translationOpeningStatements`).
  // Same resolution the Opening Dialogues panel uses, so generated lines land
  // in the tab that reads them.
  const { data: catalogLanguages = [] } = useGetAvailableLanguageVoicesQuery({
    active: true,
    voicesNeeded: true,
  }) as { data: LanguageOption[] };
  const openingDialoguePrimaryLanguageId = formMethods.watch("openingDialoguePrimaryLanguageId") as
    | number
    | null
    | undefined;
  const primaryLanguageId = useResolvedPrimaryLanguageId(
    catalogLanguages,
    openingDialoguePrimaryLanguageId,
  );
  // Read inside the async fan-out, which outlives this render.
  const primaryLanguageIdRef = useRef(primaryLanguageId);
  primaryLanguageIdRef.current = primaryLanguageId;
  const catalogLanguagesRef = useRef(catalogLanguages);
  catalogLanguagesRef.current = catalogLanguages;

  // In-flight mutation handles (each exposes `.abort()`) + a flag the resolve/
  // reject callbacks read to stop applying once the user has aborted.
  const handlesRef = useRef<{ abort: () => void }[]>([]);
  const abortedRef = useRef(false);
  // Set synchronously while a batch is in flight so a re-entrant start() can't
  // reset the abort flag or orphan the first batch's abort handles (state-based
  // `phase` is stale within the same tick, so a ref is required).
  const runningRef = useRef(false);

  const patchTask = useCallback((key: string, patch: Partial<GenerationTask>) => {
    setTasks(prev => prev.map(t => (t.key === key ? { ...t, ...patch } : t)));
  }, []);

  const start = useCallback(
    (inputs: GenerationInputs) => {
      // Ignore re-entrant calls while a batch is already running so we never
      // reset the abort flag or lose the running batch's abort handles.
      if (runningRef.current) return;
      runningRef.current = true;
      abortedRef.current = false;
      setChecks([]);
      const plan = (
        inputs.includeStates && !fieldPlan.some(t => t.field === STATES_FIELD.field)
          ? [...BASE_FIELD_PLAN, STATES_FIELD, SPOKEN_LANGUAGES_FIELD]
          : fieldPlan
      )
        .filter(t => !(inputs.libraryCharacter && CHARACTER_FIELDS.has(t.field)))
        .filter(t => !(inputs.statesOnForm && t.field === STATES_FIELD.field));
      const withCover = inputs.generateCover !== false;
      setTasks([
        ...plan.map(t => ({
          ...t,
          key: t.field,
          status: (isStageOne(t.field) ? "active" : "waiting") as GenerationTaskStatus,
        })),
        ...(withCover ? [{ ...COVER_TASK, status: "waiting" as GenerationTaskStatus }] : []),
      ]);
      setPhase("running");

      const handles: { abort: () => void }[] = [];
      // Per-field promises, so the voice pick can wait on `persona` alone
      // rather than on the whole batch — it needs the gender, nothing else.
      const runsByField = new Map<AgentBuilderField, Promise<void>>();
      // Assigned once the stage-one runs exist (below); resolves to what they
      // settled, read back from the form. Never rejects — runTask swallows —
      // so a failed foundation field just means less context, not no stage two.
      let foundation: Promise<AgentBuilderEstablishedContext | undefined> =
        Promise.resolve(undefined);

      /**
       * Fire one field (optionally for one language), keeping the abort handle
       * and settling that row's status. Resolves once the row is settled — and,
       * for `spoken_languages`, once its whole fan-out has settled too, so the
       * batch's `allSettled` covers the dependent calls without extra
       * bookkeeping.
       */
      const runTask = (task: {
        key: string;
        field: AgentBuilderField;
        languageId?: string;
        establishedContext?: AgentBuilderEstablishedContext;
      }): Promise<void> => {
        const handle = trigger({
          field: task.field,
          actorDescription: inputs.actorDescription,
          competency: inputs.competency,
          agentTestCases: inputs.agentTestCases,
          ...(task.languageId ? { languageId: task.languageId } : {}),
          ...(task.establishedContext ? { establishedContext: task.establishedContext } : {}),
          ...(task.field === "knowledge_sources"
            ? { numKnowledgeSources: DEFAULT_KNOWLEDGE_SOURCES }
            : {}),
          ...(task.field === "states" && inputs.roleplayMode
            ? { roleplayMode: inputs.roleplayMode }
            : {}),
          // Reminders fill the main language's tab: say which, or the writer follows the brief's
          // language (Hindi reminders in the English tab when the client speaks Hindi).
          ...(task.field === "reminders" && primaryLanguageIdRef.current != null
            ? { languageId: String(primaryLanguageIdRef.current) }
            : {}),
        });
        handles.push(handle);
        return handle
          .unwrap()
          .then(res => {
            if (abortedRef.current) return undefined;
            // The language answer isn't applied to the form — it schedules the
            // per-language calls, and awaiting them here keeps them inside the
            // batch's own settle.
            if (task.field === "spoken_languages") {
              return fanOutLanguages(toSpokenLanguages(res.value));
            }
            const applied = applyAgentBuilderField(task.field, res.value, formMethods, {
              validate: false,
              languageId: task.languageId,
              primaryLanguageId: primaryLanguageIdRef.current,
            });
            patchTask(task.key, { status: applied ? "done" : "empty" });
            return undefined;
          })
          .catch(err => {
            patchTask(
              task.key,
              abortedRef.current
                ? { status: "aborted" }
                : { status: "error", error: errorMessage(err) },
            );
          });
      };

      /**
       * Fire a stage-two row once the foundation has settled, with what it
       * established attached. A Stop pressed while the row was waiting leaves
       * it unfired (abort() has already marked it cancelled).
       */
      const runAfterFoundation = async (task: {
        key: string;
        field: AgentBuilderField;
        languageId?: string;
      }): Promise<void> => {
        const establishedContext = await foundation;
        if (abortedRef.current) return;
        patchTask(task.key, { status: "active" });
        return runTask({ ...task, establishedContext });
      };

      /**
       * Append a row per (language-scoped field × language) and fire them all.
       * The language row itself resolves to the names so the trainer can see
       * what was inferred from the brief — and spot a wrong guess before
       * reviewing the tabs.
       */
      const fanOutLanguages = (
        languages: AgentBuilderSpokenLanguage[],
        chosen = false,
      ): Promise<void> => {
        if (languages.length === 0) {
          patchTask(SPOKEN_LANGUAGES_FIELD.field, { status: "empty" });
          return Promise.resolve();
        }
        patchTask(SPOKEN_LANGUAGES_FIELD.field, {
          status: "done",
          label: `${chosen ? "Languages you chose" : SPOKEN_LANGUAGES_FIELD.label}: ${languages
            .map(l => l.label)
            .join(", ")}`,
        });
        const languageTasks = languages.flatMap(language =>
          LANGUAGE_FIELD_PLAN.map(({ field, label }) => ({
            key: `${field}:${language.languageId}`,
            field,
            languageId: language.languageId,
            label: `${label} (${language.label})`,
          })),
        );
        setTasks(prev => [
          ...prev,
          ...languageTasks.map(t => ({ ...t, status: "waiting" as GenerationTaskStatus })),
          { ...LANGUAGE_VOICES_TASK, status: "waiting" as GenerationTaskStatus },
        ]);
        return Promise.allSettled([
          ...languageTasks.map(runAfterFoundation),
          assignVoices(languages),
        ]).then(() => undefined);
      };

      /**
       * Cast a voice for each generated language, once the persona has landed
       * so the model knows who it is voicing. Languages the trainer already
       * mapped are left exactly as they are — the cast is asked only for the
       * ones still empty, and never overwrites a deliberate choice.
       */
      const assignVoices = async (languages: AgentBuilderSpokenLanguage[]): Promise<void> => {
        // The persona is a foundation field, so waiting on the foundation
        // covers it. Never rejects, so this resolves either way; a failed
        // persona just means casting with no gender to match.
        const establishedContext = await foundation;
        if (abortedRef.current) {
          patchTask(LANGUAGE_VOICES_TASK.key, { status: "aborted" });
          return;
        }
        patchTask(LANGUAGE_VOICES_TASK.key, { status: "active" });

        const personaGender = formMethods.getValues("gender") as string | undefined;
        const personaAge = formMethods.getValues("age") as number | undefined;
        const existingLanguageVoices =
          (formMethods.getValues("languageVoices") as Record<string, string> | undefined) ?? {};
        const unmapped = languages.filter(
          language => !existingLanguageVoices[String(language.languageId)],
        );
        if (unmapped.length === 0) {
          patchTask(LANGUAGE_VOICES_TASK.key, { status: "empty" });
          return;
        }

        let cast: ReturnType<typeof toCastPicks> = [];
        try {
          const handle = trigger({
            field: LANGUAGE_VOICES_TASK.field,
            actorDescription: inputs.actorDescription,
            competency: inputs.competency,
            agentTestCases: inputs.agentTestCases,
            languageIds: unmapped.map(language => String(language.languageId)),
            ...(personaGender ? { personaGender } : {}),
            ...(typeof personaAge === "number" ? { personaAge } : {}),
            ...(establishedContext ? { establishedContext } : {}),
          });
          handles.push(handle);
          const res = await handle.unwrap();
          const unmappedIds = new Set(unmapped.map(language => String(language.languageId)));
          cast = toCastPicks(Array.isArray(res.value) ? res.value : [], personaGender)
            // Enforced here rather than trusted from the request: only the
            // unmapped languages were asked for, but a pick for any other one
            // would silently replace a voice the trainer chose by hand.
            .filter(pick => unmappedIds.has(pick.languageId));
        } catch {
          // A failed or aborted cast is not fatal: the mapping is mandatory to
          // publish, so falling back to the picker's own order still leaves the
          // trainer a working simulation to review.
          if (abortedRef.current) {
            patchTask(LANGUAGE_VOICES_TASK.key, { status: "aborted" });
            return;
          }
        }
        if (abortedRef.current) {
          patchTask(LANGUAGE_VOICES_TASK.key, { status: "aborted" });
          return;
        }

        const castIds = new Set(cast.map(pick => pick.languageId));
        const picks = [
          ...cast,
          ...pickVoicesForLanguages({
            languages: unmapped.filter(language => !castIds.has(String(language.languageId))),
            catalog: catalogLanguagesRef.current,
            personaGender,
            personaAge,
            existingLanguageVoices,
          }),
        ];
        if (picks.length === 0) {
          patchTask(LANGUAGE_VOICES_TASK.key, { status: "empty" });
          return;
        }
        formMethods.setValue(
          "languageVoices",
          {
            ...existingLanguageVoices,
            ...Object.fromEntries(picks.map(pick => [pick.languageId, pick.voiceId])),
          },
          { shouldDirty: true, shouldValidate: false },
        );
        patchTask(LANGUAGE_VOICES_TASK.key, {
          status: "done",
          label: `${LANGUAGE_VOICES_TASK.label}: ${describeVoicePicks(picks, personaGender)}`,
        });
      };

      // Stage one fires now. `persona` and `spoken_languages` run in parallel.
      // `challenge_description` runs after `persona` completes, using its output
      // as context to ensure consistency. The final `foundation` promise for
      // stage two waits for all three to settle.
      // A library character's persona is already on the form, so there is nothing to wait for.
      const personaRun = inputs.libraryCharacter
        ? Promise.resolve()
        : runTask({ key: "persona", field: "persona" });
      runsByField.set("persona", personaRun);

      const challengeDescRun = personaRun.then(() => {
        if (abortedRef.current) return Promise.resolve();
        // Read just the persona from the form; challenge_description isn't there
        // yet. This becomes the context for generating the description.
        const personaContext = readEstablishedContext(formMethods);
        return runTask({
          key: "challenge_description",
          field: "challenge_description",
          establishedContext: personaContext,
        });
      });
      runsByField.set("challenge_description", challengeDescRun);

      // `spoken_languages` is independent of the other foundation fields and can
      // run in parallel with `persona`. Languages the trainer chose skip the detection call.
      runsByField.set(
        SPOKEN_LANGUAGES_FIELD.field,
        inputs.languages?.length
          ? fanOutLanguages(inputs.languages, true)
          : runTask({ key: SPOKEN_LANGUAGES_FIELD.field, field: SPOKEN_LANGUAGES_FIELD.field }),
      );

      // The `foundation` promise resolves once both foundation fields have
      // settled, and its value is the context for all stage-two calls.
      foundation = Promise.allSettled([personaRun, challengeDescRun]).then(() =>
        abortedRef.current ? undefined : readEstablishedContext(formMethods),
      );

      for (const { field } of plan.filter(t => !isStageOne(t.field))) {
        runsByField.set(field, runAfterFoundation({ key: field, field }));
      }

      /**
       * The cover, once the title exists (and the challenge and persona it is drawn from). Never
       * rejects: a cover that can't be made (no permission, moderation, timeout) is one row's
       * note, not a failed batch.
       */
      const makeCover = async (): Promise<void> => {
        await Promise.allSettled([foundation, runsByField.get("title")]);
        if (abortedRef.current) return;
        if (String(formMethods.getValues("coverImageUrl") ?? "").trim()) {
          patchTask(COVER_TASK.key, {
            status: "empty",
            label: `${COVER_TASK.label}: kept the existing one`,
          });
          return;
        }
        const title = plainText(formMethods.getValues("title"), 300);
        if (!title) {
          patchTask(COVER_TASK.key, {
            status: "empty",
            label: `${COVER_TASK.label}: needs a title first`,
          });
          return;
        }
        patchTask(COVER_TASK.key, { status: "active" });
        const age = Number(formMethods.getValues("age"));
        try {
          const started = startCoverJob({
            title,
            description: plainText(formMethods.getValues("description"), 2000) || undefined,
            name: plainText(formMethods.getValues("name"), 200) || undefined,
            ...(Number.isInteger(age) && age > 0 && age <= 120 ? { age } : {}),
            gender: plainText(formMethods.getValues("gender"), 100) || undefined,
            profession: plainText(formMethods.getValues("profession"), 200) || undefined,
            currentLocation: plainText(formMethods.getValues("currentLocation"), 300) || undefined,
          });
          handles.push(started);
          const job = await started.unwrap();
          const deadline = Date.now() + COVER_MAX_WAIT_MS;
          let status = job;
          while (status.status === "running" && Date.now() < deadline) {
            await sleep(COVER_POLL_MS);
            if (abortedRef.current) return;
            status = await pollCoverJob(job.jobId).unwrap();
          }
          if (abortedRef.current) return;
          if (status.status === "succeeded" && status.imageUrl) {
            formMethods.setValue("coverImageUrl", status.imageUrl, {
              shouldDirty: true,
              shouldValidate: false,
            });
            patchTask(COVER_TASK.key, { status: "done" });
          } else if (status.status === "running") {
            patchTask(COVER_TASK.key, {
              status: "error",
              error: "still generating; pick it later from the image library",
            });
          } else {
            patchTask(COVER_TASK.key, {
              status: "error",
              error: status.error || "generation failed",
            });
          }
        } catch (err) {
          if (abortedRef.current) return;
          const forbidden = (err as { status?: number })?.status === 403;
          patchTask(COVER_TASK.key, {
            status: "error",
            error: forbidden
              ? "you don't have permission to generate cover images"
              : errorMessage(err),
          });
        }
      };
      if (withCover) runsByField.set("cover_image" as AgentBuilderField, makeCover());
      const runs = [...runsByField.values()];
      // Same array the per-language calls push into later, so Stop cancels
      // them too even though they don't exist yet at this point.
      handlesRef.current = handles;

      /**
       * The challenge description in the roleplay's other languages: every catalog language with
       * a voice on the form (the languages a learner can play in), apart from the main one whose
       * text was just generated. Runs last, once the description and the voices are both in.
       */
      const translateDescription = async (): Promise<void> => {
        const voices = (formMethods.getValues("languageVoices") ?? {}) as Record<string, string>;
        const primary = String(primaryLanguageIdRef.current ?? "");
        const targets = catalogLanguagesRef.current
          .filter(l => voices[String(l.language_id)] && String(l.language_id) !== primary)
          .map(l => ({ languageId: String(l.language_id), languageCode: l.value }));
        // The main-language fields with a tab per language: the challenge description, and the
        // reminders the learner reads during the session.
        const fields = [
          { source: "description", target: "translationDescription" },
          { source: "reminders", target: "translationReminders" },
        ]
          .map(f => ({ ...f, text: String(formMethods.getValues(f.source) ?? "").trim() }))
          .filter(f => f.text);
        if (!fields.length || !targets.length || abortedRef.current) return;
        setTasks(prev => [...prev, { ...TRANSLATE_TASK, status: "active" }]);
        const results = await Promise.allSettled(
          fields.map(async f => {
            const handle = translateField({ text: f.text, targets });
            handles.push(handle);
            const { translations } = await handle.unwrap();
            if (abortedRef.current) return;
            const current = (formMethods.getValues(f.target) ?? {}) as Record<string, string>;
            formMethods.setValue(
              f.target,
              { ...current, ...translations },
              { shouldDirty: true, shouldValidate: false },
            );
          }),
        );
        if (abortedRef.current) {
          patchTask(TRANSLATE_TASK.key, { status: "aborted" });
          return;
        }
        const failed = results.find(r => r.status === "rejected") as
          | PromiseRejectedResult
          | undefined;
        patchTask(
          TRANSLATE_TASK.key,
          failed
            ? { status: "error", error: errorMessage(failed.reason) }
            : { status: "done", label: `${TRANSLATE_TASK.label} (${targets.length})` },
        );
      };

      void Promise.allSettled(runs).then(async () => {
        await translateDescription();
        runningRef.current = false;
        if (abortedRef.current) {
          setPhase("aborted");
          return;
        }
        setPhase("done");
        if (inputs.roleplayMode) setChecks(checkAgainstMode(formMethods));
        // Validate once now the batch is applied, so mandatory-field state and
        // the parent autosave settle from the final values (not per keystroke).
        void formMethods.trigger();
      });
    },
    [trigger, startCoverJob, pollCoverJob, translateField, formMethods, patchTask, fieldPlan],
  );

  const abort = useCallback(() => {
    if (abortedRef.current) return;
    abortedRef.current = true;
    runningRef.current = false;
    handlesRef.current.forEach(h => {
      try {
        h.abort();
      } catch {
        /* already settled */
      }
    });
    setTasks(prev =>
      prev.map(t =>
        t.status === "active" || t.status === "waiting" ? { ...t, status: "aborted" } : t,
      ),
    );
    setPhase("aborted");
  }, []);

  const reset = useCallback(() => {
    abortedRef.current = false;
    runningRef.current = false;
    handlesRef.current = [];
    setTasks([]);
    setChecks([]);
    setPhase("idle");
  }, []);

  // Cancel any in-flight requests if the wizard unmounts (e.g. tab switch).
  useEffect(
    () => () => {
      abortedRef.current = true;
      handlesRef.current.forEach(h => {
        try {
          h.abort();
        } catch {
          /* already settled */
        }
      });
    },
    [],
  );

  const doneCount = tasks.filter(t => t.status !== "active" && t.status !== "waiting").length;
  const appliedCount = tasks.filter(t => t.status === "done").length;

  return { phase, tasks, start, abort, reset, doneCount, appliedCount, checks };
};
