import { useCallback, useState } from "react";

import { UseFormReturn } from "react-hook-form";

import { useEnhanceFieldMutation, useRevisePlanMutation } from "@api";

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

        await Promise.allSettled(
          plan.fields.map(async field => {
            const isState = field.id.startsWith(STATE_PREFIX);
            try {
              const response = await enhanceField({
                fieldName: isState ? "state" : field.id,
                currentValue: values.get(field.id) ?? "",
                guidance:
                  `${note}\nIn this field: ${field.change}\n` +
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
    [formMethods, requestPlan, enhanceField, patchLast],
  );

  const resetRevisions = useCallback(() => setRevisions([]), []);

  return { revisions, revise, busy, resetRevisions };
};
