import { useCallback, useState } from "react";

import { UseFormReturn } from "react-hook-form";

import {
  useEnhanceFieldMutation,
  useGetAvailableLanguageVoicesQuery,
  useRevisePlanMutation,
} from "@api";
import { en } from "@constants";

import { fieldsOfKind, ROLEPLAY_AGENT_FIELDS } from "../../utils/roleplayAgentFields";

/**
 * After the roleplay is generated, a trainer's message changes only what it is about. One call
 * plans which fields the request touches (and what to change in each); each of those is then
 * rewritten from its current text by enhance-field, the same call the form's Improve buttons
 * make. Every other field, including the trainer's own edits, is left exactly as it is.
 *
 * Which fields a message can change comes from ROLEPLAY_AGENT_FIELDS (utils/roleplayAgentFields),
 * so a field added to the form is changeable here once it is listed there.
 */

/** The settings the agent may change, as one JSON field. */
export const SETTINGS_ID = "settings";

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
  /** What changed, when it is worth saying (e.g. which settings). */
  detail?: string;
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

/** One field the plan may pick: what it is now, how it is improved, and how it lands. */
interface RevisionTarget {
  id: string;
  label: string;
  value: string;
  fieldName: string;
  fieldLabel?: string;
  translateTo?: { languageId: string; languageCode: string }[];
  /** Writes the result to the form; may say what changed, for the chat. */
  apply: (content: string, translations?: Record<string, string>) => string | void;
}

const splitLines = (value: string) =>
  value
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean);
const asText = (value: unknown): string =>
  Array.isArray(value) ? value.filter(v => typeof v === "string").join("\n") : text(value);

const DURATION = /^(\d{2}):([0-5]\d):([0-5]\d)$/;
const seconds = (value: string) => {
  const m = DURATION.exec(value);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : NaN;
};

/** A setting's value is one the form can hold (the type, the choices, the range). */
export const acceptSetting = (id: string, value: unknown): boolean => {
  const field = ROLEPLAY_AGENT_FIELDS[id];
  if (field?.kind !== "setting") return false;
  if (field.type === "boolean") return typeof value === "boolean";
  if (field.type === "number") return typeof value === "number" && Number.isFinite(value);
  if (field.type === "duration") {
    if (typeof value !== "string" || !DURATION.test(value)) return false;
    const s = seconds(value);
    return (!field.min || s >= seconds(field.min)) && (!field.max || s <= seconds(field.max));
  }
  return typeof value === "string" && (field.options ?? []).includes(value);
};

/** The settings the form holds now, each of the type the registry says. */
const readSettings = (formMethods: UseFormReturn<any>) =>
  Object.fromEntries(
    fieldsOfKind("setting")
      .map(([id]) => [id, formMethods.getValues(id)] as const)
      .filter(([id, value]) => acceptSetting(id, value)),
  ) as Record<string, boolean | number | string>;

/** A setting's value in words, for the chat ("on", "Hard", "00:15:00"). */
const settingValue = (value: unknown) =>
  value === true ? "on" : value === false ? "off" : String(value);

/** Every field the plan may pick, read from the form as it is now. */
const buildTargets = (
  formMethods: UseFormReturn<any>,
  catalog: CatalogLanguage[] = [],
): RevisionTarget[] => {
  const set = (id: string, value: unknown) =>
    formMethods.setValue(id, value, { shouldDirty: true });
  const languageLabel = (id: string) =>
    catalog.find(l => String(l.language_id) === id)?.label ?? `language ${id}`;
  const languageCode = (id: string) =>
    (catalog.find(l => String(l.language_id) === id) as { value?: string } | undefined)?.value;
  const targets: RevisionTarget[] = [];

  for (const [formId, field] of fieldsOfKind("text")) {
    const translations = fieldsOfKind("translation").filter(([, t]) => t.of === formId);
    const translateTo = translations.flatMap(([translationId]) =>
      Object.entries((formMethods.getValues(translationId) ?? {}) as Record<string, unknown>)
        .filter(([languageId, value]) => asText(value).trim() && languageCode(languageId))
        .map(([languageId]) => ({ languageId, languageCode: languageCode(languageId)! })),
    );
    targets.push({
      id: field.enhanceAs ?? formId,
      label: field.label,
      value: asText(formMethods.getValues(formId)),
      fieldName: field.enhanceAs ?? "text",
      ...(field.enhanceAs ? {} : { fieldLabel: field.label }),
      ...(translateTo.length ? { translateTo } : {}),
      apply: (content, translated) => {
        set(formId, content);
        for (const [translationId, translation] of translations) {
          const current = (formMethods.getValues(translationId) ?? {}) as Record<string, unknown>;
          const next = { ...current };
          for (const [languageId, value] of Object.entries(translated ?? {})) {
            if (!(languageId in current) || !value?.trim()) continue;
            next[languageId] = translation.shape === "lines" ? splitLines(value) : value;
          }
          set(translationId, next);
        }
      },
    });
  }

  for (const [formId, field] of fieldsOfKind("perLanguage")) {
    const map = (formMethods.getValues(formId) ?? {}) as Record<string, unknown>;
    for (const [languageId, value] of Object.entries(map)) {
      const label = `${field.label} (${languageLabel(languageId)})`;
      targets.push({
        id: `${formId}:${languageId}`,
        label,
        value: asText(value),
        fieldName: field.enhanceAs ?? "text",
        ...(field.enhanceAs ? {} : { fieldLabel: label }),
        apply: content => {
          const current = (formMethods.getValues(formId) ?? {}) as Record<string, unknown>;
          set(formId, {
            ...current,
            [languageId]: field.shape === "lines" ? splitLines(content) : content,
          });
        },
      });
    }
  }

  for (const [formId, field] of fieldsOfKind("items")) {
    const items = formMethods.getValues(formId);
    for (const item of Array.isArray(items) ? items : []) {
      if (!item?.id) continue;
      const label = `${field.label} "${item.title ?? ""}"`;
      targets.push({
        id: `${formId}:${item.id}`,
        label,
        value: text(item.content),
        fieldName: field.enhanceAs ?? "text",
        ...(field.enhanceAs ? {} : { fieldLabel: label }),
        apply: content => {
          const current = formMethods.getValues(formId);
          set(
            formId,
            (Array.isArray(current) ? current : []).map((row: { id?: string }) =>
              row?.id === item.id ? { ...row, content } : row,
            ),
          );
        },
      });
    }
  }

  const details = readCharacterDetails(formMethods);
  if (details.name || details.gender) {
    targets.push({
      id: CHARACTER_DETAILS_ID,
      label: en.agentBuilderRevision.characterDetails,
      value: JSON.stringify(details),
      fieldName: CHARACTER_DETAILS_ID,
      // Applied by its own step (it runs first and steers the others).
      apply: () => undefined,
    });
  }

  const settings = readSettings(formMethods);
  if (Object.keys(settings).length) {
    const described = Object.keys(settings)
      .map(id => {
        const field = ROLEPLAY_AGENT_FIELDS[id] as Extract<
          (typeof ROLEPLAY_AGENT_FIELDS)[string],
          { kind: "setting" }
        >;
        const values =
          field.type === "boolean"
            ? "true or false"
            : field.type === "number"
              ? "a number"
              : field.type === "duration"
                ? `a time as HH:MM:SS, from ${field.min ?? "00:00:00"} to ${field.max ?? "02:00:00"}`
                : `one of ${(field.options ?? []).join(", ")}`;
        return `- ${id}: ${field.label} (${values})`;
      })
      .join("\n");
    targets.push({
      id: SETTINGS_ID,
      // Short: the plan's labels are capped (200 characters); the value names every setting,
      // and the improve call gets each one's meaning and allowed values.
      label: en.agentBuilderRevision.settings,
      value: JSON.stringify(settings),
      fieldName: SETTINGS_ID,
      fieldLabel: described,
      apply: content => {
        const changed = JSON.parse(content) as Record<string, unknown>;
        const made: string[] = [];
        for (const [id, value] of Object.entries(changed)) {
          if (!(id in settings) || value === settings[id] || !acceptSetting(id, value)) continue;
          set(id, value);
          const label = (ROLEPLAY_AGENT_FIELDS[id] as { label: string }).label;
          made.push(`${label}: ${settingValue(settings[id])} → ${settingValue(value)}`);
        }
        return made.length ? made.join("; ") : en.agentBuilderRevision.noSettingChanged;
      },
    });
  }

  const states = (formMethods.getValues("states") ?? []) as FormState[];
  for (const state of Array.isArray(states) ? states : []) {
    if (!state?.id) continue;
    targets.push({
      id: `${STATE_PREFIX}${state.id}`,
      label: `State "${state.name ?? ""}"`,
      value: JSON.stringify({ name: state.name ?? "", guidelines: state.guidelines ?? "" }),
      fieldName: "state",
      apply: content => {
        const parsed = JSON.parse(content) as { name?: string; guidelines?: string };
        const current = (formMethods.getValues("states") ?? []) as FormState[];
        set(
          "states",
          current.map(row =>
            row.id === state.id
              ? {
                  ...row,
                  ...(typeof parsed.name === "string" ? { name: parsed.name } : {}),
                  ...(typeof parsed.guidelines === "string"
                    ? { guidelines: parsed.guidelines }
                    : {}),
                }
              : row,
          ),
        );
      },
    });
  }

  return targets.filter(target => target.value.trim());
};

/** The form's revisable fields as they are now, for the plan. */
export const readRevisableFields = (
  formMethods: UseFormReturn<any>,
  catalog: CatalogLanguage[] = [],
) => buildTargets(formMethods, catalog).map(({ id, label, value }) => ({ id, label, value }));

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
      const catalog = (Array.isArray(voiceCatalog) ? voiceCatalog : []) as CatalogLanguage[];
      const targets = buildTargets(formMethods, catalog);
      const fields = targets.map(({ id, label, value }) => ({ id, label, value }));
      try {
        const plan = await requestPlan({ instruction: note, fields }).unwrap();
        const targetsById = new Map(targets.map(target => [target.id, target]));
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
              const target = targetsById.get(field.id);
              try {
                if (!target) throw new Error("not on the form");
                const response = await enhanceField({
                  fieldName: target.fieldName,
                  ...(target.fieldLabel ? { fieldLabel: target.fieldLabel } : {}),
                  ...(target.translateTo ? { translateTo: target.translateTo } : {}),
                  currentValue: target.value,
                  guidance:
                    `${note}\nIn this field: ${field.change}\n` +
                    (newDetails ? `${newDetails}\n` : "") +
                    "Change only what this asks for; keep everything else exactly as it is.",
                }).unwrap();
                const content = response?.content;
                if (typeof content !== "string" || !content.trim()) {
                  throw new Error("came back empty");
                }
                const detail = target.apply(content, response?.translations);
                setRow(field.id, { status: "done", ...(detail ? { detail } : {}) });
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
