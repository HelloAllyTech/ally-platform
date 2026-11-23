import { useEffect, useRef, useState } from "react";

import { CheckCircle, FailIcon } from "@icons";
import { UseFormReturn, useWatch } from "react-hook-form";

import { AutoExpandableTextarea } from "@ally-ui-mono/ui-shared";
import {
  AgentBuilderCharacterSuggestions,
  ROLEPLAY_MODES,
  RoleplayDesign,
  RoleplayMode,
  useGetAgentTestCasesQuery,
  useGetAvailableLanguageVoicesQuery,
  useLazyGetCharacterByIdQuery,
  useLazyGetRoleplayDesignQuery,
  useSuggestAgentBuilderCharactersMutation,
} from "@api";
import { en } from "@constants";
import { applyCharacterToForm } from "@utils/characterApply";
import {
  ModeRecommendation,
  recommendMode,
  suggestNextSteps,
} from "@utils/agentBuilderSuggestions";

import { Button } from "../button";
import { Competency } from "../competency";
import { ButtonVariant } from "../types";
import {
  GenerationTask,
  GenerationTaskStatus,
  useAgentBuilderGeneration,
} from "./useAgentBuilderGeneration";

/**
 * Chat-style wizard on the RIGHT half of the "Agent Builder Copilot" tab.
 *
 * Flow:
 *   1. "Describe roleplay actor"   — long free-text input
 *   2. "Select one competency"     — the shared Basic Settings competency dropdown
 *   3. "Choose the roleplay's mode" — learning / practice / performance / assessment (the
 *      Course Design Manual). Picking one puts that mode's supports, experience mode and
 *      state-aware main prompt on the form, and the states are laid out for it (a rupture
 *      state below 0, bands sized for the mode) — the same rules Course Copilot uses.
 *   4. "Select agent test cases" — multi-select from the live catalog
 *   5. Generation                  — on submit, the copilot combines the inputs
 *      inputs and fires ONE LLM call per Basic Settings field IN PARALLEL. Each
 *      result is parsed and painted into the mirrored Basic Settings form on the
 *      LEFT the moment it returns; the chat here streams per-task logs. The user
 *      can Stop at any time (native request abort). The brief also decides
 *      which languages the client speaks, so the three per-language fields
 *      (opening dialogues, style samples, filler words) appear in the feed once
 *      per language and fill that language's tab.
 *
 * All field writes flow through the shared `formMethods`, so the left pane and
 * the Basic Settings tab stay in sync automatically.
 */

type WizardStepId =
  | "describe"
  | "competency"
  | "mode"
  | "character"
  | "languages"
  | "goals"
  | "generate"
  | "restored";

/** "Write a new character" in the character step. */
const NEW_CHARACTER = "new";

/**
 * The conversation as saved on the roleplay (form field `agentBuilderChat` →
 * scenarios.metadata.agentBuilderChat), so reopening the roleplay shows it again.
 */
export interface SavedAgentBuilderChat {
  version: 1;
  history: { question: string; answer: string }[];
  description: string;
  mode?: RoleplayMode;
  states?: boolean;
  goalIds: string[];
  /** The Character Library character used, when one was. */
  character?: { id: string; name: string };
  /** The languages chosen in the wizard (absent: decided from the description). */
  languages?: { languageId: string; label: string; code: string }[];
  /** What the trainer told the agent in the chat box; every field follows these. */
  notes?: string[];
  /** The test cases' titles, to generate again with the same answers. */
  goalTitles?: string[];
  result: { applied: number; total: number; stopped: boolean; checks: string[] };
  generatedAt: string;
}

const isSavedChat = (value: unknown): value is SavedAgentBuilderChat =>
  Boolean(value) &&
  typeof value === "object" &&
  Array.isArray((value as SavedAgentBuilderChat).history) &&
  (value as SavedAgentBuilderChat).history.length > 0;

const modeStrings = en.agentBuilderMode;
const suggestionStrings = en.agentBuilderSuggestions;
const restoredStrings = en.agentBuilderRestored;
const characterStrings = en.agentBuilderCharacter;
const chatStrings = en.agentBuilderChatBox;
const languageStrings = en.agentBuilderLanguages;
/** "The agent picks a voice" in a language's voice menu. */
const AGENT_VOICE = "";

interface CatalogVoice {
  id: string;
  name: string;
  provider?: string;
  gender?: string | null;
  age?: string | null;
}
interface CatalogLanguage {
  language_id: number;
  value: string;
  label: string;
  voices?: CatalogVoice[];
}

/** One "what to review" line, in words. */
const nextStepText = (step: ReturnType<typeof suggestNextSteps>[number]): string => {
  const message = suggestionStrings.next[step.key];
  return typeof message === "function" ? message(step.count ?? 0) : message;
};

const QUESTIONS: Record<Exclude<WizardStepId, "generate" | "restored">, string> = {
  describe: "Describe roleplay actor",
  competency: "Select one competency",
  mode: modeStrings.question,
  character: en.agentBuilderCharacter.question,
  languages: en.agentBuilderLanguages.question,
  goals: "Select agent test cases",
};

/** The mode's supports in words, for the chat feed. */
const describeDesign = (design: RoleplayDesign): string => {
  const supports = [
    design.settings.remindersEnabled && modeStrings.supports.reminders,
    design.settings.currentState && modeStrings.supports.stateVisible,
    design.settings.supervisorNotesEnabled && modeStrings.supports.supervisorNotes,
    design.states && modeStrings.supports.states,
  ].filter(Boolean) as string[];
  return modeStrings.applied(modeStrings.labels[design.mode] ?? design.mode, supports);
};

interface ChatEntry {
  question: string;
  answer: string;
}

interface AgentBuilderCopilotWizardProps {
  // Shared react-hook-form instance — the competency pick + generated values
  // all write here, keeping the Basic Settings tab in sync.
  formMethods: UseFormReturn<any>;
}

const Spinner = () => (
  <div className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-dashed border-primary-300 border-t-transparent" />
);

const TaskStatusIcon = ({ status }: { status: GenerationTaskStatus }) => {
  if (status === "active") return <Spinner />;
  // Queued behind the foundation fields — a still, hollow ring, so it reads as
  // "next" rather than as work in progress.
  if (status === "waiting")
    return (
      <span className="inline-block h-4 w-4 shrink-0 rounded-full border-2 border-border-light" />
    );
  if (status === "done") return <CheckCircle size={16} className="shrink-0 text-[#43A047]" />;
  if (status === "error") return <FailIcon size={16} className="shrink-0 text-[#FE6F64]" />;
  // empty / aborted — muted dash.
  return <span className="inline-block h-4 w-4 shrink-0 text-center text-typography-400">–</span>;
};

const taskNote = (task: GenerationTask): string | null => {
  if (task.status === "error") return task.error || "generation failed";
  if (task.status === "empty") return "no content generated";
  if (task.status === "aborted") return "cancelled";
  if (task.status === "waiting") return "waits for description and persona";
  return null;
};

export const AgentBuilderCopilotWizard: React.FC<AgentBuilderCopilotWizardProps> = ({
  formMethods,
}) => {
  const [step, setStep] = useState<WizardStepId>("describe");
  const [history, setHistory] = useState<ChatEntry[]>([]);
  const [description, setDescription] = useState("");
  const [selectedGoals, setSelectedGoals] = useState<string[]>([]);
  const [mode, setMode] = useState<RoleplayMode>("practice");
  const [design, setDesign] = useState<RoleplayDesign | null>(null);
  const [modeError, setModeError] = useState(false);
  const [recommendation, setRecommendation] = useState<ModeRecommendation | null>(null);
  const [restored, setRestored] = useState<SavedAgentBuilderChat | null>(null);
  const [suggestions, setSuggestions] = useState<AgentBuilderCharacterSuggestions | null>(null);
  const [characterChoice, setCharacterChoice] = useState<string>(NEW_CHARACTER);
  const [character, setCharacter] = useState<{
    id: string;
    name: string;
    profile: string;
  } | null>(null);
  const [characterError, setCharacterError] = useState(false);
  // The chat box: anything the trainer wants the agent to know, at any step.
  const [notes, setNotes] = useState<string[]>([]);
  const [noteDraft, setNoteDraft] = useState("");
  const [goalTitlesUsed, setGoalTitlesUsed] = useState<string[]>([]);
  const [notesSinceGeneration, setNotesSinceGeneration] = useState(false);
  // Languages and voices: decided from the description, or chosen here (language → voice id,
  // "" = the agent picks one to match the client).
  const [chooseLanguages, setChooseLanguages] = useState(false);
  const [languageVoices, setLanguageVoices] = useState<Record<string, string>>({});
  const [languagesError, setLanguagesError] = useState(false);
  const [chosenLanguages, setChosenLanguages] = useState<
    { languageId: string; label: string; code: string }[]
  >([]);
  const { data: languageCatalogData } = useGetAvailableLanguageVoicesQuery({
    active: true,
    voicesNeeded: true,
  });
  const languageCatalog = (
    Array.isArray(languageCatalogData) ? languageCatalogData : []
  ) as CatalogLanguage[];
  const [suggestCharacters, { isLoading: loadingSuggestions }] =
    useSuggestAgentBuilderCharactersMutation();
  const [fetchCharacter, { isFetching: loadingCharacter }] = useLazyGetCharacterByIdQuery();
  const [fetchDesign, { isFetching: loadingDesign }] = useLazyGetRoleplayDesignQuery();

  const competency = useWatch({
    control: formMethods.control,
    name: "competency",
  });

  const {
    data: goalsData,
    isLoading: isLoadingGoals,
    isError: goalsFailed,
  } = useGetAgentTestCasesQuery();
  const goalOptions = goalsData?.data ?? [];
  // Test cases only steer generation. With none to pick (the Agent Test Cases feature is off for
  // this account, or none exist yet) the wizard goes on without them rather than stopping here.
  const canSkipGoals = !isLoadingGoals && (goalsFailed || goalOptions.length === 0);

  const { phase, tasks, start, abort, reset, doneCount, appliedCount, checks } =
    useAgentBuilderGeneration(formMethods);

  // Reopening a roleplay: the saved conversation arrives with the form's values (after the
  // fetch), so restore it the first time it appears, unless the trainer has already started.
  const savedChat = useWatch({ control: formMethods.control, name: "agentBuilderChat" });
  const restoreCheckedRef = useRef(false);
  useEffect(() => {
    if (restoreCheckedRef.current || !isSavedChat(savedChat)) return;
    restoreCheckedRef.current = true;
    if (step !== "describe" || history.length > 0 || description.trim()) return;
    setRestored(savedChat);
    setHistory(savedChat.history);
    setDescription(savedChat.description ?? "");
    if (savedChat.mode) setMode(savedChat.mode);
    setSelectedGoals(savedChat.goalIds ?? []);
    setNotes(savedChat.notes ?? []);
    setGoalTitlesUsed(savedChat.goalTitles ?? []);
    setStep("restored");
  }, [savedChat, step, history.length, description]);

  // A finished (or stopped) run is saved on the roleplay with the form, by the page's autosave.
  const savedPhaseRef = useRef<string>("idle");
  useEffect(() => {
    if (phase === savedPhaseRef.current) return;
    savedPhaseRef.current = phase;
    if (phase !== "done" && phase !== "aborted") return;
    const chat: SavedAgentBuilderChat = {
      version: 1,
      history,
      description: description.trim(),
      ...(design ? { mode: design.mode, states: design.states } : {}),
      goalIds: selectedGoals,
      ...(character ? { character: { id: character.id, name: character.name } } : {}),
      notes,
      goalTitles: goalTitlesUsed,
      ...(chosenLanguages.length ? { languages: chosenLanguages } : {}),
      result: { applied: appliedCount, total: tasks.length, stopped: phase === "aborted", checks },
      generatedAt: new Date().toISOString(),
    };
    restoreCheckedRef.current = true;
    formMethods.setValue("agentBuilderChat", chat, { shouldDirty: true, shouldValidate: false });
    formMethods.setValue("agentBuilderDescription", chat.description, {
      shouldDirty: true,
      shouldValidate: false,
    });
  }, [
    phase,
    history,
    description,
    design,
    selectedGoals,
    appliedCount,
    tasks.length,
    checks,
    formMethods,
  ]);

  const pushHistory = (question: string, answer: string) =>
    setHistory(prev => [...prev, { question, answer }]);

  const handleDescribeNext = () => {
    if (!description.trim()) return;
    pushHistory(QUESTIONS.describe, description.trim());
    setStep("competency");
  };

  const handleCompetencyNext = () => {
    const competency = formMethods.getValues("competency");
    if (!competency?.name) return;
    pushHistory(QUESTIONS.competency, competency.name);
    // Pre-pick the mode the trainer's own words point to; they can choose another.
    const recommended = recommendMode(description);
    setRecommendation(recommended);
    setMode(recommended.mode);
    setStep("mode");
  };

  // Puts the mode's settings on the form (the trainer can still change any of them on the left).
  const handleModeNext = async () => {
    setModeError(false);
    try {
      const picked = await fetchDesign(mode).unwrap();
      Object.entries(picked.settings).forEach(([field, value]) =>
        formMethods.setValue(field, value, { shouldDirty: true, shouldValidate: false }),
      );
      setDesign(picked);
      pushHistory(QUESTIONS.mode, describeDesign(picked));
      setStep("character");
      void loadSuggestions(picked.mode);
    } catch {
      setModeError(true);
    }
  };

  // Library characters for this description, with the fit check's pick pre-selected.
  const loadSuggestions = async (pickedMode: RoleplayMode, withNotes: string[] = notes) => {
    setSuggestions(null);
    setCharacterChoice(NEW_CHARACTER);
    const competency = formMethods.getValues("competency");
    try {
      const found = await suggestCharacters({
        description: [description.trim(), ...withNotes].join("\n"),
        ...(competency?.id ? { competencyIds: [String(competency.id)] } : {}),
        mode: pickedMode,
      }).unwrap();
      setSuggestions(found);
      if (found.recommendedId) setCharacterChoice(found.recommendedId);
    } catch {
      setSuggestions({ characters: [], recommendedId: null, reason: null, searchFailed: true });
    }
  };

  const handleCharacterNext = async () => {
    setCharacterError(false);
    if (characterChoice === NEW_CHARACTER) {
      setCharacter(null);
      pushHistory(QUESTIONS.character, characterStrings.newAnswer);
      enterLanguages();
      return;
    }
    try {
      const picked = await fetchCharacter(characterChoice).unwrap();
      applyCharacterToForm(formMethods, picked);
      setCharacter({
        id: characterChoice,
        name: picked.name,
        profile: picked.characterProfileText ?? "",
      });
      pushHistory(QUESTIONS.character, characterStrings.libraryAnswer(picked.name));
      enterLanguages();
    } catch {
      setCharacterError(true);
    }
  };

  /**
   * Into the languages step. A library character who already speaks some languages (voices on
   * the form now) starts with those chosen and their voices kept.
   */
  const enterLanguages = () => {
    const onForm = (formMethods.getValues("languageVoices") ?? {}) as Record<string, string>;
    const known = Object.fromEntries(
      Object.entries(onForm).filter(
        ([id, voice]) => voice && languageCatalog.some(l => String(l.language_id) === id),
      ),
    );
    setLanguageVoices(known);
    setChooseLanguages(Object.keys(known).length > 0);
    setLanguagesError(false);
    setStep("languages");
  };

  const toggleLanguage = (languageId: string) =>
    setLanguageVoices(previous => {
      const next = { ...previous };
      if (languageId in next) delete next[languageId];
      else next[languageId] = AGENT_VOICE;
      return next;
    });

  const handleLanguagesNext = () => {
    if (!chooseLanguages) {
      setChosenLanguages([]);
      pushHistory(QUESTIONS.languages, languageStrings.fromDescriptionAnswer);
      setStep("goals");
      return;
    }
    const picked = languageCatalog.filter(l => String(l.language_id) in languageVoices);
    if (!picked.length) {
      setLanguagesError(true);
      return;
    }
    // Chosen voices go on the form now; the agent casts only the languages left to it.
    const chosenVoices = Object.fromEntries(
      Object.entries(languageVoices).filter(([, voice]) => voice !== AGENT_VOICE),
    );
    if (Object.keys(chosenVoices).length) {
      const current = (formMethods.getValues("languageVoices") ?? {}) as Record<string, string>;
      formMethods.setValue(
        "languageVoices",
        { ...current, ...chosenVoices },
        { shouldDirty: true, shouldValidate: false },
      );
    }
    setChosenLanguages(
      picked.map(l => ({ languageId: String(l.language_id), label: l.label, code: l.value })),
    );
    pushHistory(
      QUESTIONS.languages,
      picked
        .map(l => {
          const voiceId = languageVoices[String(l.language_id)];
          const voice = l.voices?.find(v => v.id === voiceId);
          return `${l.label}: ${voice ? voice.name : languageStrings.agentPicks}`;
        })
        .join("; "),
    );
    setStep("goals");
  };

  const toggleGoal = (goalId: string) =>
    setSelectedGoals(prev =>
      prev.includes(goalId) ? prev.filter(g => g !== goalId) : [...prev, goalId],
    );

  const handleGenerate = () => {
    if (selectedGoals.length === 0 && !canSkipGoals) return;
    const selected = goalOptions.filter(goal => selectedGoals.includes(goal.id));
    const goalTitles = selected.map(goal => goal.title);
    pushHistory(
      QUESTIONS.goals,
      goalTitles.length ? goalTitles.join(", ") : en.agentBuilderMode.noGoals,
    );

    // Persist the selection on the scenario (rides the normal save payload →
    // scenarios.metadata.agentTestCaseIds) and steer every field prompt.
    formMethods.setValue("agentTestCaseIds", selectedGoals, { shouldDirty: true });

    setGoalTitlesUsed(goalTitles);
    runGeneration(goalTitles);
  };

  /**
   * The brief every field is written from: the description, a library character's saved profile
   * (so nothing contradicts who they are, as Course Copilot does) and the trainer's notes.
   */
  const composeBrief = (): string => {
    const parts = [description.trim()];
    const characterName = character?.name ?? restored?.character?.name;
    if (characterName) {
      const profile = String(
        formMethods.getValues("characterProfileText") ?? character?.profile ?? "",
      );
      parts.push(`${characterStrings.briefNote(characterName)}\n${profile.slice(0, 2500)}`);
    }
    if (notes.length) {
      parts.push(`${chatStrings.briefNotes}\n${notes.map(note => `- ${note}`).join("\n")}`);
    }
    return parts.join("\n\n");
  };

  const runGeneration = (goalTitles: string[]) => {
    const runMode = design?.mode ?? restored?.mode;
    const runStates = design?.states ?? restored?.states;
    setNotesSinceGeneration(false);
    setStep("generate");
    start({
      actorDescription: composeBrief(),
      competency: formMethods.getValues("competency")?.name,
      agentTestCases: goalTitles.join(", "),
      ...(runMode ? { roleplayMode: runMode, includeStates: Boolean(runStates) } : {}),
      ...(character || restored?.character ? { libraryCharacter: true } : {}),
      ...((chosenLanguages.length ? chosenLanguages : (restored?.languages ?? [])).length
        ? { languages: chosenLanguages.length ? chosenLanguages : restored!.languages }
        : {}),
    });
  };

  /** The chat box: a note for the agent, which also acts on the step it is sent at. */
  const handleSendNote = () => {
    const note = noteDraft.trim();
    if (!note) return;
    const nextNotes = [...notes, note];
    setNotes(nextNotes);
    setNoteDraft("");
    pushHistory("", note);
    if (step === "mode") {
      // "this is the final check" re-picks the mode; a note that names none leaves the pick.
      const fromNote = recommendMode(note);
      if (fromNote.reason !== "practice" || /\bpractice\b/i.test(note)) {
        setRecommendation(fromNote);
        setMode(fromNote.mode);
      }
    } else if (step === "character" && design) {
      void loadSuggestions(design.mode, nextNotes);
    } else if (step === "generate" || step === "restored") {
      setNotesSinceGeneration(true);
    }
  };

  const handleStartOver = () => {
    reset();
    setHistory([]);
    // From a saved conversation, keep its description to edit rather than retype.
    setDescription(restored?.description ?? "");
    setSelectedGoals([]);
    setMode("practice");
    setRecommendation(null);
    setRestored(null);
    setSuggestions(null);
    setCharacterChoice(NEW_CHARACTER);
    setCharacter(null);
    setCharacterError(false);
    setNotes([]);
    setNoteDraft("");
    setGoalTitlesUsed([]);
    setNotesSinceGeneration(false);
    setChooseLanguages(false);
    setLanguageVoices({});
    setChosenLanguages([]);
    setLanguagesError(false);
    setDesign(null);
    setModeError(false);
    setStep("describe");
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Conversation area — answered questions + live generation logs. */}
      <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col gap-4 pb-4">
        {history.length === 0 && step === "describe" && (
          <div className="self-start max-w-[90%] rounded-lg bg-background-secondary px-4 py-2 text-sm text-typography-700">
            Answer six quick questions and I&apos;ll generate the Basic Settings on the left in
            parallel — each field fills in as it&apos;s ready, and you can stop anytime.
          </div>
        )}

        {history.map((entry, index) => (
          <div key={index} className="flex flex-col gap-2">
            {/* A chat-box note has no question: it is the trainer speaking first. */}
            {entry.question && (
              <div className="self-start max-w-[85%] break-words rounded-lg bg-background-secondary px-4 py-2 text-sm text-typography-800">
                {entry.question}
              </div>
            )}
            <div className="self-end max-w-[85%] break-words rounded-lg bg-primary-50 px-4 py-2 text-sm text-typography-900 whitespace-pre-wrap">
              {entry.answer}
            </div>
          </div>
        ))}

        {step === "restored" && restored && (
          <div className="flex flex-col gap-3" data-testid="restored-chat">
            <div className="rounded-md border border-border-light bg-neutral-50 p-3 text-sm text-typography-900">
              {restoredStrings.summary(
                new Date(restored.generatedAt).toLocaleString(),
                restored.result.applied,
                restored.result.total,
                restored.result.stopped,
              )}
            </div>
            {restored.mode && restored.states === false && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-typography-900">
                {modeStrings.noStatePrompt}
              </div>
            )}
            {restored.result.checks.includes("remindersHidden") && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-typography-900">
                {modeStrings.remindersHidden}
              </div>
            )}
            <div
              className="rounded-md border border-border-light bg-white p-3 text-sm text-typography-900"
              data-testid="next-steps"
            >
              <p className="font-medium">{suggestionStrings.nextTitle}</p>
              <ul className="mt-1 list-disc pl-5 text-typography-800">
                {suggestNextSteps(formMethods.getValues(), restored.mode).map(next => (
                  <li key={next.key}>{nextStepText(next)}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {step === "generate" && (
          <div className="flex flex-col gap-3">
            {/* Per-task progress block. */}
            <div className="rounded-md border border-border-light bg-neutral-50 p-3">
              <div className="flex items-center gap-2 text-sm font-medium text-typography-800">
                {phase === "running" ? (
                  <Spinner />
                ) : (
                  <CheckCircle size={16} className="text-[#43A047]" />
                )}
                Generating settings ({doneCount}/{tasks.length})
              </div>
              <div className="mt-2 flex flex-col gap-0.5 pl-1">
                {tasks.map(task => {
                  const note = taskNote(task);
                  return (
                    <div key={task.key} className="flex items-center gap-2 py-1 text-sm">
                      <TaskStatusIcon status={task.status} />
                      <span
                        className={
                          task.status === "error"
                            ? "text-[#FE6F64]"
                            : task.status === "empty" ||
                                task.status === "aborted" ||
                                task.status === "waiting"
                              ? "text-typography-500"
                              : "text-typography-800"
                        }
                      >
                        {task.label}
                      </span>
                      {note && <span className="text-xs text-typography-500">· {note}</span>}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Terminal banner. */}
            {phase === "done" && (
              <div className="rounded-md border border-success-200 bg-success-50 p-3 text-sm text-typography-900">
                Filled {appliedCount} of {tasks.length} fields — review them in Basic Settings on
                the left, then Save or Publish.
              </div>
            )}
            {phase === "done" && design && (!design.states || checks.length > 0) && (
              <div
                className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-typography-900"
                data-testid="mode-checks"
              >
                {!design.states && <p>{modeStrings.noStatePrompt}</p>}
                {checks.includes("remindersHidden") && <p>{modeStrings.remindersHidden}</p>}
              </div>
            )}
            {phase === "done" && (
              <div
                className="rounded-md border border-border-light bg-white p-3 text-sm text-typography-900"
                data-testid="next-steps"
              >
                <p className="font-medium">{suggestionStrings.nextTitle}</p>
                <ul className="mt-1 list-disc pl-5 text-typography-800">
                  {suggestNextSteps(formMethods.getValues(), design?.mode).map(step => (
                    <li key={step.key}>{nextStepText(step)}</li>
                  ))}
                </ul>
              </div>
            )}
            {phase === "aborted" && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-typography-900">
                Generation stopped. Fields that finished before you stopped were kept — review them
                on the left.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bottom composer — the active question, or the generation controls.
          It may shrink: the panel around it has a fixed height and hides
          overflow, so a long description or a long list of test cases used to
          push the Next / Generate button out of sight. The question scrolls
          inside the composer instead, and the button row never does. */}
      <div className="shrink min-h-0 border-t border-border-light pt-4 flex flex-col gap-3">
        {/* The chat box: from the second step on (the first is already free text). */}
        {step !== "describe" && (
          <div className="shrink-0 flex flex-col gap-2" data-testid="agent-chat-box">
            <div className="flex items-end gap-2">
              <AutoExpandableTextarea
                value={noteDraft}
                onChange={setNoteDraft}
                placeholder={chatStrings.placeholder[step] ?? chatStrings.placeholder.default}
                minHeight={40}
                maxLines={6}
                className="w-full rounded border border-border-light px-3 py-2 bg-white text-sm"
              />
              <Button
                variant={ButtonVariant.SECONDARY}
                onClick={handleSendNote}
                disabled={!noteDraft.trim() || phase === "running"}
                className="h-[40px] px-4 shrink-0"
              >
                {chatStrings.send}
              </Button>
            </div>
            {notesSinceGeneration && phase !== "running" && (
              <div className="flex items-center justify-between gap-2 rounded-md border border-primary-200 bg-primary-50 px-3 py-2 text-sm">
                <span>{chatStrings.regenerateHint}</span>
                <Button
                  variant={ButtonVariant.PRIMARY}
                  onClick={() => runGeneration(goalTitlesUsed)}
                  className="h-[36px] px-4 shrink-0"
                >
                  {chatStrings.regenerate}
                </Button>
              </div>
            )}
          </div>
        )}
        {step === "describe" && (
          <>
            <div className="min-h-0 overflow-y-auto custom-scrollbar flex flex-col gap-3">
              <h3 className="text-base font-medium text-typography-900">{QUESTIONS.describe}</h3>
              {!description.trim() && (
                <div className="flex flex-col gap-1.5" data-testid="actor-ideas">
                  <p className="text-xs text-typography-600">{suggestionStrings.ideasTitle}</p>
                  <div className="flex flex-wrap gap-2">
                    {suggestionStrings.ideas.map(idea => (
                      <button
                        key={idea.label}
                        type="button"
                        title={idea.text}
                        onClick={() => setDescription(idea.text)}
                        className="rounded-full border border-border-light bg-white px-3 py-1 text-xs text-typography-800 hover:border-primary hover:bg-primary-50"
                      >
                        {idea.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <AutoExpandableTextarea
                value={description}
                onChange={setDescription}
                placeholder="Describe the person the AI should role-play — who they are, their background, what's bringing them to this session, how they speak and behave..."
                minHeight={96}
                maxLines={24}
                className="w-full rounded border border-border-light px-3 py-2 bg-white text-base"
              />
            </div>
            <div className="shrink-0 flex justify-end">
              <Button
                variant={ButtonVariant.PRIMARY}
                onClick={handleDescribeNext}
                disabled={!description.trim()}
                className="h-[40px] px-6"
              >
                Next
              </Button>
            </div>
          </>
        )}

        {step === "competency" && (
          <>
            <h3 className="text-base font-medium text-typography-900">{QUESTIONS.competency}</h3>
            {/* The wizard asks for exactly one — its generation prompt takes a
                single competency name — so the picker runs in single-select
                mode rather than the builder's multi-select. */}
            <Competency
              id="competency"
              formMethods={formMethods}
              label="Select one competency"
              isMandatory
              dropUp
              singleSelect
            />
            <div className="flex justify-end">
              <Button
                variant={ButtonVariant.PRIMARY}
                onClick={handleCompetencyNext}
                disabled={!competency?.name}
                className="h-[40px] px-6"
              >
                Next
              </Button>
            </div>
          </>
        )}

        {step === "mode" && (
          <>
            <div className="min-h-0 overflow-y-auto custom-scrollbar flex flex-col gap-2">
              <h3 className="text-base font-medium text-typography-900">{QUESTIONS.mode}</h3>
              <p className="text-xs text-typography-600">{modeStrings.help}</p>
              {recommendation && (
                <p className="text-xs text-typography-800" data-testid="mode-reason">
                  {modeStrings.recommended}: {modeStrings.labels[recommendation.mode]}.{" "}
                  {modeStrings.reasons[recommendation.reason]}
                </p>
              )}
              <div role="radiogroup" aria-label={QUESTIONS.mode} className="flex flex-col gap-2">
                {ROLEPLAY_MODES.map(option => {
                  const checked = mode === option;
                  return (
                    <label
                      key={option}
                      className={`flex items-start gap-3 rounded border px-3 py-2 cursor-pointer transition-colors ${
                        checked
                          ? "border-primary bg-primary-50"
                          : "border-border-light hover:bg-background-secondary"
                      }`}
                    >
                      <input
                        type="radio"
                        name="roleplay-mode"
                        value={option}
                        checked={checked}
                        onChange={() => setMode(option)}
                        className="accent-primary mt-1"
                      />
                      <span className="flex flex-col">
                        <span className="flex items-center gap-2 text-sm text-typography-900">
                          {modeStrings.labels[option]}
                          {recommendation?.mode === option && (
                            <span className="rounded bg-primary-100 px-1.5 py-0.5 text-[11px] font-medium text-primary-700">
                              {modeStrings.recommended}
                            </span>
                          )}
                        </span>
                        <span className="text-xs text-typography-600">
                          {modeStrings.descriptions[option]}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
              {modeError && <p className="text-sm text-[#FE6F64]">{modeStrings.failed}</p>}
            </div>
            <div className="shrink-0 flex justify-end">
              <Button
                variant={ButtonVariant.PRIMARY}
                onClick={handleModeNext}
                disabled={loadingDesign}
                className="h-[40px] px-6"
              >
                {loadingDesign ? modeStrings.loading : "Next"}
              </Button>
            </div>
          </>
        )}

        {step === "character" && (
          <>
            <div className="min-h-0 overflow-y-auto custom-scrollbar flex flex-col gap-2">
              <h3 className="text-base font-medium text-typography-900">{QUESTIONS.character}</h3>
              {loadingSuggestions || !suggestions ? (
                <p className="text-sm text-typography-700">{characterStrings.searching}</p>
              ) : (
                <>
                  <p className="text-xs text-typography-600" data-testid="character-note">
                    {suggestions.searchFailed
                      ? characterStrings.searchFailed
                      : suggestions.characters.length === 0
                        ? characterStrings.noMatch
                        : suggestions.recommendedId
                          ? characterStrings.recommendedBecause(suggestions.reason ?? "")
                          : characterStrings.noneFits(suggestions.reason ?? "")}
                  </p>
                  <div
                    role="radiogroup"
                    aria-label={QUESTIONS.character}
                    className="flex flex-col gap-2"
                  >
                    {suggestions.characters.map(option => {
                      const checked = characterChoice === option.id;
                      return (
                        <label
                          key={option.id}
                          className={`flex items-start gap-3 rounded border px-3 py-2 cursor-pointer transition-colors ${
                            checked
                              ? "border-primary bg-primary-50"
                              : "border-border-light hover:bg-background-secondary"
                          }`}
                        >
                          <input
                            type="radio"
                            name="roleplay-character"
                            value={option.id}
                            checked={checked}
                            onChange={() => setCharacterChoice(option.id)}
                            className="accent-primary mt-1"
                          />
                          <span className="flex flex-col">
                            <span className="flex items-center gap-2 text-sm text-typography-900">
                              {option.name}
                              {suggestions.recommendedId === option.id && (
                                <span className="rounded bg-primary-100 px-1.5 py-0.5 text-[11px] font-medium text-primary-700">
                                  {modeStrings.recommended}
                                </span>
                              )}
                            </span>
                            {option.summary && (
                              <span className="text-xs text-typography-600">{option.summary}</span>
                            )}
                            {option.profileExcerpt && (
                              <span className="text-xs text-typography-500 line-clamp-2">
                                {option.profileExcerpt}
                              </span>
                            )}
                            {!option.hasVoices && (
                              <span className="text-xs text-amber-700">
                                {characterStrings.noVoices}
                              </span>
                            )}
                          </span>
                        </label>
                      );
                    })}
                    <label
                      className={`flex items-start gap-3 rounded border px-3 py-2 cursor-pointer transition-colors ${
                        characterChoice === NEW_CHARACTER
                          ? "border-primary bg-primary-50"
                          : "border-border-light hover:bg-background-secondary"
                      }`}
                    >
                      <input
                        type="radio"
                        name="roleplay-character"
                        value={NEW_CHARACTER}
                        checked={characterChoice === NEW_CHARACTER}
                        onChange={() => setCharacterChoice(NEW_CHARACTER)}
                        className="accent-primary mt-1"
                      />
                      <span className="flex flex-col">
                        <span className="text-sm text-typography-900">
                          {characterStrings.newOption}
                        </span>
                        <span className="text-xs text-typography-600">
                          {characterStrings.newOptionHelp}
                        </span>
                      </span>
                    </label>
                  </div>
                </>
              )}
              {characterError && (
                <p className="text-sm text-[#FE6F64]">{characterStrings.loadFailed}</p>
              )}
            </div>
            <div className="shrink-0 flex justify-end">
              <Button
                variant={ButtonVariant.PRIMARY}
                onClick={handleCharacterNext}
                disabled={loadingSuggestions || !suggestions || loadingCharacter}
                className="h-[40px] px-6"
              >
                Next
              </Button>
            </div>
          </>
        )}

        {step === "languages" && (
          <>
            <div className="min-h-0 overflow-y-auto custom-scrollbar flex flex-col gap-2">
              <h3 className="text-base font-medium text-typography-900">{QUESTIONS.languages}</h3>
              <div
                role="radiogroup"
                aria-label={QUESTIONS.languages}
                className="flex flex-col gap-2"
              >
                {[false, true].map(choose => (
                  <label
                    key={String(choose)}
                    className={`flex items-start gap-3 rounded border px-3 py-2 cursor-pointer transition-colors ${
                      chooseLanguages === choose
                        ? "border-primary bg-primary-50"
                        : "border-border-light hover:bg-background-secondary"
                    }`}
                  >
                    <input
                      type="radio"
                      name="roleplay-languages"
                      value={choose ? "choose" : "describe"}
                      checked={chooseLanguages === choose}
                      onChange={() => setChooseLanguages(choose)}
                      className="accent-primary mt-1"
                    />
                    <span className="flex flex-col">
                      <span className="text-sm text-typography-900">
                        {choose ? languageStrings.chooseOption : languageStrings.describeOption}
                      </span>
                      <span className="text-xs text-typography-600">
                        {choose ? languageStrings.chooseHelp : languageStrings.describeHelp}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
              {chooseLanguages && (
                <div className="flex flex-col gap-1.5 max-h-[260px] overflow-y-auto custom-scrollbar pr-1">
                  {languageCatalog.map(language => {
                    const id = String(language.language_id);
                    const checked = id in languageVoices;
                    return (
                      <div
                        key={id}
                        className={`flex flex-wrap items-center gap-2 rounded border px-3 py-2 ${
                          checked ? "border-primary bg-primary-50" : "border-border-light"
                        }`}
                      >
                        <label className="flex flex-1 min-w-[140px] items-center gap-2 cursor-pointer text-sm text-typography-900">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleLanguage(id)}
                            className="accent-primary"
                          />
                          {language.label}
                        </label>
                        {checked && (
                          <select
                            aria-label={languageStrings.voiceFor(language.label)}
                            value={languageVoices[id]}
                            onChange={event =>
                              setLanguageVoices(previous => ({
                                ...previous,
                                [id]: event.target.value,
                              }))
                            }
                            className="rounded border border-border-light bg-white px-2 py-1 text-xs"
                          >
                            <option value={AGENT_VOICE}>{languageStrings.agentPicksOption}</option>
                            {(language.voices ?? []).map(voice => (
                              <option key={voice.id} value={voice.id}>
                                {[voice.name, voice.gender, voice.provider?.toLowerCase()]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              {languagesError && (
                <p className="text-sm text-[#FE6F64]">{languageStrings.pickOne}</p>
              )}
            </div>
            <div className="shrink-0 flex justify-end">
              <Button
                variant={ButtonVariant.PRIMARY}
                onClick={handleLanguagesNext}
                className="h-[40px] px-6"
              >
                Next
              </Button>
            </div>
          </>
        )}

        {step === "goals" && (
          <>
            <h3 className="shrink-0 text-base font-medium text-typography-900">
              {QUESTIONS.goals}
            </h3>
            <div className="min-h-0 flex flex-col gap-2 max-h-[280px] overflow-y-auto custom-scrollbar">
              {isLoadingGoals ? (
                <p className="text-sm text-typography-700">Loading agent test cases…</p>
              ) : goalsFailed ? (
                <p className="text-sm text-typography-700">
                  {en.agentBuilderMode.goalsUnavailable}
                </p>
              ) : goalOptions.length === 0 ? (
                <p className="text-sm text-typography-700">
                  No agent test cases configured yet. Add some under the Agent Test Cases tab, or
                  generate without them.
                </p>
              ) : (
                goalOptions.map(goal => {
                  const checked = selectedGoals.includes(goal.id);
                  return (
                    <label
                      key={goal.id}
                      className={`flex items-start gap-3 rounded border px-3 py-2 cursor-pointer transition-colors ${
                        checked
                          ? "border-primary bg-primary-50"
                          : "border-border-light hover:bg-background-secondary"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleGoal(goal.id)}
                        className="accent-primary mt-1"
                      />
                      <span className="flex flex-col">
                        <span className="text-sm text-typography-900">{goal.title}</span>
                        <span className="text-xs text-typography-600">{goal.tags?.join(", ")}</span>
                      </span>
                    </label>
                  );
                })
              )}
            </div>
            <div className="shrink-0 flex justify-end">
              <Button
                variant={ButtonVariant.PRIMARY}
                onClick={handleGenerate}
                disabled={selectedGoals.length === 0 && !canSkipGoals}
                className="h-[40px] px-6"
              >
                Generate
              </Button>
            </div>
          </>
        )}

        {step === "restored" && (
          <div className="flex justify-end">
            <Button
              variant={ButtonVariant.SECONDARY}
              onClick={handleStartOver}
              className="h-[40px] px-6"
            >
              {restoredStrings.startOver}
            </Button>
          </div>
        )}

        {step === "generate" && (
          <div className="flex justify-end">
            {phase === "running" ? (
              <Button variant={ButtonVariant.SECONDARY} onClick={abort} className="h-[40px] px-6">
                Stop generating
              </Button>
            ) : (
              <Button
                variant={ButtonVariant.SECONDARY}
                onClick={handleStartOver}
                className="h-[40px] px-6"
              >
                Start over
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
