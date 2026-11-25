import { useCallback, useState } from "react";

import { UseFormReturn } from "react-hook-form";

import {
  useEnhanceFieldMutation,
  useGetAvailableLanguageVoicesQuery,
  useRevisePlanMutation,
} from "@api";
import { en } from "@constants";

/**
 * After the roleplay is generated, a trainer's message changes only what it is about. One call
 * plans which fields the request touches (and what to change in each); each of those is then
 * rewritten from its current text by enhance-field, the same call the form's Improve buttons
 * make. Every other field, including the trainer's own edits, is left exactly as it is.
 */

/** The fields a message can change, by the id the plan uses and the form field they live in. */
const REVISABLE_FIELDS: { id: string; formId: string; label: string }[] = [
  { id: "roleInstruction", formId: "prompt", label: "Role instruction" },
  { id: "title", formId: "title", label: "Title" },
  { id: "description", formId: "description", label: "Challenge description" },
  { id: "characterProfileText", formId: "characterProfileText", label: "Character backstory" },
  { id: "openingStatements", formId: "openingStatements", label: "Opening lines" },
  { id: "reminders", formId: "reminders", label: "Reminders" },
];

const STATE_PREFIX = "state:";

/**
 * Who the client is, as one JSON field: a change to it ("make him a girl") is planned and
 * rewritten as a whole, then every other field is rewritten to match (the backend's rule).
 */
export const CHARACTER_DETAILS_ID = "characterDetails";
const CHARACTER_DETAIL_KEYS = [
  "name",
  "age",
  "gender",
  "genderIdentity",
  "sexualOrientation",
  "profession",
  "currentLocation",
] as const;
type CharacterDetails = Partial<Record<(typeof CHARACTER_DETAIL_KEYS)[number], string | number>>;

const readCharacterDetails = (formMethods: UseFormReturn<any>): CharacterDetails =>
  Object.fromEntries(
    CHARACTER_DETAIL_KEYS.map(key => [key, formMethods.getValues(key) ?? ""]),
  ) as CharacterDetails;

/**
 * What the fields rewritten after the character details are told about the new client. The name
 * is an instruction, so every field uses the same one; the rest is reference, so a field that
 * never mentioned the age does not gain it.
 */
export const describeCharacterChange = (
  before: CharacterDetails,
  after: CharacterDetails,
): string => {
  const lines: string[] = [];
  if (after.name && after.name !== before.name) {
    lines.push(
      `The client's name is now "${after.name}"${before.name ? ` (it was "${before.name}")` : ""}: ` +
        `wherever this text names the client, use exactly "${after.name}".`,
    );
  }
  const reference = [
    after.age && `age ${after.age}`,
    after.gender && `gender ${after.gender}`,
    after.genderIdentity && `gender identity ${after.genderIdentity}`,
    after.sexualOrientation && `sexual orientation ${after.sexualOrientation}`,
  ].filter(Boolean);
  if (reference.length) {
    lines.push(
      `For reference, the client is now: ${reference.join(", ")}. Use these only where this ` +
        "text already describes the client; never add them, or the name, where it did not.",
    );
  }
  return lines.join("\n");
};

interface CatalogLanguage {
  language_id: number;
  label: string;
  voices?: { id: string; gender?: string | null }[];
}

/**
 * The form's voices after a gender change: a voice of another gender is swapped for the
 * language's first voice of the new gender; a voice with no gender recorded is kept.
 */
export const voicesForGender = (
  current: Record<string, string>,
  gender: string,
  catalog: CatalogLanguage[],
): { voices: Record<string, string>; unmatched: string[] } => {
  const wanted = gender.toLowerCase();
  const voices = { ...current };
  const unmatched: string[] = [];
  for (const [languageId, voiceId] of Object.entries(current)) {
    const language = catalog.find(l => String(l.language_id) === languageId);
    const voice = language?.voices?.find(v => v.id === voiceId);
    const voiceGender = voice?.gender?.toLowerCase();
    if (!language || !voiceGender || voiceGender === wanted) continue;
    const replacement = language.voices?.find(v => v.gender?.toLowerCase() === wanted);
    if (replacement) voices[languageId] = replacement.id;
    else unmatched.push(language.label);
  }
  return { voices, unmatched };
};

export type RevisionRowStatus = "active" | "done" | "error";

export interface RevisionRow {
  id: string;
  label: string;
  status: RevisionRowStatus;
  error?: string;
}

export interface Revision {
  note: string;
  status: "planning" | "applying" | "done" | "failed";
  /** The agent's one-line answer: what it will change. */
  reply?: string;
  rows: RevisionRow[];
  error?: string;
}

interface FormState {
  id: string;
  name?: string;
  guidelines?: string;
  [key: string]: unknown;
}

const text = (value: unknown): string => (typeof value === "string" ? value : "");

const errorMessage = (err: unknown): string => {
  const anyErr = err as { data?: { message?: string }; error?: string; message?: string };
  return anyErr?.data?.message || anyErr?.error || anyErr?.message || "could not be changed";
};

/** The form's revisable fields as they are now, for the plan. */
export const readRevisableFields = (formMethods: UseFormReturn<any>) => {
  const fields = REVISABLE_FIELDS.map(field => ({
    id: field.id,
    label: field.label,
    value: text(formMethods.getValues(field.formId)),
  }));
  const details = readCharacterDetails(formMethods);
  if (details.name || details.gender) {
    fields.push({
      id: CHARACTER_DETAILS_ID,
      label: en.agentBuilderRevision.characterDetails,
      value: JSON.stringify(details),
    });
  }
  const states = (formMethods.getValues("states") ?? []) as FormState[];
  for (const state of Array.isArray(states) ? states : []) {
    if (!state?.id) continue;
    fields.push({
      id: `${STATE_PREFIX}${state.id}`,
      label: `State "${state.name ?? ""}"`,
      value: JSON.stringify({ name: state.name ?? "", guidelines: state.guidelines ?? "" }),
    });
  }
  return fields.filter(field => field.value.trim());
};

export const useAgentBuilderRevision = (formMethods: UseFormReturn<any>) => {
  const [requestPlan] = useRevisePlanMutation();
  const [enhanceField] = useEnhanceFieldMutation();
  const { data: voiceCatalog } = useGetAvailableLanguageVoicesQuery({
    active: true,
    voicesNeeded: true,
  });
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [busy, setBusy] = useState(false);

  const patchLast = useCallback((patch: (revision: Revision) => Revision) => {
    setRevisions(previous =>
      previous.length ? [...previous.slice(0, -1), patch(previous[previous.length - 1])] : previous,
    );
  }, []);

  const revise = useCallback(
    async (note: string) => {
      setBusy(true);
      setRevisions(previous => [...previous, { note, status: "planning", rows: [] }]);
      const fields = readRevisableFields(formMethods);
      try {
        const plan = await requestPlan({ instruction: note, fields }).unwrap();
        const labels = new Map(fields.map(field => [field.id, field.label]));
        const values = new Map(fields.map(field => [field.id, field.value]));
        patchLast(revision => ({
          ...revision,
          status: plan.fields.length ? "applying" : "done",
          reply: plan.reply,
          rows: plan.fields.map(field => ({
            id: field.id,
            label: labels.get(field.id) ?? field.id,
            status: "active" as RevisionRowStatus,
          })),
        }));

        const setRow = (id: string, patch: Partial<RevisionRow>) =>
          patchLast(revision => ({
            ...revision,
            rows: revision.rows.map(row => (row.id === id ? { ...row, ...patch } : row)),
          }));

        const strings = en.agentBuilderRevision;
        const addRow = (row: RevisionRow) =>
          patchLast(revision => ({ ...revision, rows: [...revision.rows, row] }));

        // Who the client is goes first: the other fields are rewritten with the new details,
        // so the backstory and the opening lines use the same new name.
        let newDetails = "";
        const characterField = plan.fields.find(field => field.id === CHARACTER_DETAILS_ID);
        if (characterField) {
          const before = readCharacterDetails(formMethods);
          try {
            const response = await enhanceField({
              fieldName: CHARACTER_DETAILS_ID,
              currentValue: values.get(CHARACTER_DETAILS_ID) ?? JSON.stringify(before),
              guidance: `${note}\nIn this field: ${characterField.change}`,
            }).unwrap();
            const after = JSON.parse(String(response?.content ?? "")) as CharacterDetails;
            for (const key of CHARACTER_DETAIL_KEYS) {
              if (after[key] === undefined || after[key] === "") continue;
              formMethods.setValue(key, after[key], { shouldDirty: true });
            }
            newDetails = describeCharacterChange(before, after);
            setRow(CHARACTER_DETAILS_ID, { status: "done" });

            const genderChanged =
              typeof after.gender === "string" &&
              after.gender.toLowerCase() !== String(before.gender ?? "").toLowerCase();
            if (genderChanged) {
              const current = (formMethods.getValues("languageVoices") ?? {}) as Record<
                string,
                string
              >;
              const catalog = (
                Array.isArray(voiceCatalog) ? voiceCatalog : []
              ) as CatalogLanguage[];
              const { voices, unmatched } = voicesForGender(current, String(after.gender), catalog);
              if (JSON.stringify(voices) !== JSON.stringify(current)) {
                formMethods.setValue("languageVoices", voices, { shouldDirty: true });
              }
              if (Object.keys(current).length) {
                addRow({
                  id: "voices",
                  label: strings.voices,
                  status: unmatched.length ? "error" : "done",
                  ...(unmatched.length
                    ? { error: unmatched.map(strings.noMatchingVoice).join("; ") }
                    : {}),
                });
              }
              if (text(formMethods.getValues("coverImageUrl"))) {
                addRow({
                  id: "coverImage",
                  label: strings.coverImage,
                  status: "error",
                  error: strings.coverImageStale,
                });
              }
            }
          } catch (err) {
            setRow(CHARACTER_DETAILS_ID, { status: "error", error: errorMessage(err) });
          }
        }

        await Promise.allSettled(
          plan.fields
            .filter(field => field.id !== CHARACTER_DETAILS_ID)
            .map(async field => {
              const isState = field.id.startsWith(STATE_PREFIX);
              try {
                const response = await enhanceField({
                  fieldName: isState ? "state" : field.id,
                  currentValue: values.get(field.id) ?? "",
                  guidance:
                    `${note}\nIn this field: ${field.change}\n` +
                    (newDetails ? `${newDetails}\n` : "") +
                    "Change only what this asks for; keep everything else exactly as it is.",
                }).unwrap();
                const content = response?.content;
                if (typeof content !== "string" || !content.trim()) {
                  throw new Error("came back empty");
                }
                if (isState) {
                  const stateId = field.id.slice(STATE_PREFIX.length);
                  const parsed = JSON.parse(content) as { name?: string; guidelines?: string };
                  const states = (formMethods.getValues("states") ?? []) as FormState[];
                  formMethods.setValue(
                    "states",
                    states.map(state =>
                      state.id === stateId
                        ? {
                            ...state,
                            ...(typeof parsed.name === "string" ? { name: parsed.name } : {}),
                            ...(typeof parsed.guidelines === "string"
                              ? { guidelines: parsed.guidelines }
                              : {}),
                          }
                        : state,
                    ),
                    { shouldDirty: true },
                  );
                } else {
                  const formId = REVISABLE_FIELDS.find(f => f.id === field.id)?.formId ?? field.id;
                  formMethods.setValue(formId, content, { shouldDirty: true });
                }
                setRow(field.id, { status: "done" });
              } catch (err) {
                setRow(field.id, { status: "error", error: errorMessage(err) });
              }
            }),
        );
        patchLast(revision => ({ ...revision, status: "done" }));
      } catch (err) {
        patchLast(revision => ({ ...revision, status: "failed", error: errorMessage(err) }));
      } finally {
        setBusy(false);
      }
    },
    [formMethods, requestPlan, enhanceField, patchLast, voiceCatalog],
  );

  const resetRevisions = useCallback(() => setRevisions([]), []);

  return { revisions, revise, busy, resetRevisions };
};
