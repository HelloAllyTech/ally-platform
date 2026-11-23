import React, { useEffect, useMemo, useState } from "react";

import { toast } from "sonner";

import { SkeletonText, TextArea } from "@ally-ui-mono/ui-shared";
import { useGetRoadmapStrategyContextQuery, useUpdateRoadmapStrategyContextMutation } from "@api";
import { Button } from "@components";
import { ButtonVariant } from "@components/types";
import { RoadmapStrategyContext } from "@types";

type StrategyField = "vision" | "audience" | "bets" | "nonGoals" | "metrics";

/**
 * The page's sections, in the order the copilot reads them. Caps mirror
 * ROADMAP_STRATEGY_CONTEXT_LIMITS in ally-be, which refuses anything longer.
 *
 * Each hint says what the copilot DOES with the section, because that is what tells the writer
 * what to put in it: a non-goal it will cite back at a filer reads differently from a mission
 * statement nobody acts on.
 */
const FIELDS: {
  key: StrategyField;
  label: string;
  hint: string;
  placeholder: string;
  max: number;
}[] = [
  {
    key: "vision",
    label: "Product vision",
    hint: "What Ally is for and where it is going. The copilot uses it to judge whether an idea moves the product in that direction.",
    placeholder:
      "e.g. Every helper gets the practice and support to help well, wherever they work.",
    max: 3000,
  },
  {
    key: "audience",
    label: "Who we serve, and who first",
    hint: 'The user groups that matter most right now. The copilot pushes a vague "users" toward one of these.',
    placeholder:
      "e.g. Counsellors on partner helplines first; their supervisors second; learners on open tracks third.",
    max: 3000,
  },
  {
    key: "bets",
    label: "This period's strategic bets",
    hint: "What we are betting on this quarter or half, and why. The copilot links opportunities to these and asks how an idea advances one.",
    placeholder: "e.g. 1. Roleplay practice that measurably improves helping skills…",
    max: 5000,
  },
  {
    key: "nonGoals",
    label: "Explicit non-goals",
    hint: "What we have decided not to do. The copilot names the conflict when an idea runs into one and asks whether it is a worthwhile exception.",
    placeholder: "e.g. We are not building a general-purpose CRM for helplines.",
    max: 3000,
  },
  {
    key: "metrics",
    label: "How we measure success",
    hint: "The outcomes and numbers we steer by. The copilot uses these to propose how an opportunity's success would be measured.",
    placeholder:
      "e.g. Weekly active practising counsellors; skill growth between first and fifth session.",
    max: 3000,
  },
];

const EMPTY: Record<StrategyField, string> = {
  vision: "",
  audience: "",
  bets: "",
  nonGoals: "",
  metrics: "",
};

const fieldsOf = (page?: RoadmapStrategyContext): Record<StrategyField, string> =>
  page
    ? {
        vision: page.vision ?? "",
        audience: page.audience ?? "",
        bets: page.bets ?? "",
        nonGoals: page.nonGoals ?? "",
        metrics: page.metrics ?? "",
      }
    : EMPTY;

/**
 * Settings → Vision & strategy: the document the opportunity copilot reads on every turn.
 *
 * An explicit Save rather than the autosave the opportunity drawer uses. This is one shared
 * document a few managers edit occasionally, and every copilot conversation starts reading it
 * the moment it is saved — a half-typed paragraph autosaved mid-sentence would be what the next
 * filer's copilot argues from.
 */
export const StrategyContextManager: React.FC = () => {
  const { data: page, isLoading } = useGetRoadmapStrategyContextQuery();
  const [save, { isLoading: isSaving }] = useUpdateRoadmapStrategyContextMutation();
  const [draft, setDraft] = useState<Record<StrategyField, string>>(EMPTY);

  // Re-seed whenever the saved page changes — on first load and after a save.
  useEffect(() => {
    setDraft(fieldsOf(page));
  }, [page]);

  const saved = useMemo(() => fieldsOf(page), [page]);
  const isDirty = FIELDS.some(({ key }) => draft[key] !== saved[key]);
  const isEmpty = FIELDS.every(({ key }) => !saved[key].trim());

  const submit = async () => {
    try {
      await save(draft).unwrap();
      toast.success("Saved. The copilot uses this from its next turn.");
    } catch {
      toast.error("Could not save the strategy page.");
    }
  };

  if (isLoading) return <SkeletonText paragraph lineCount={8} />;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h3 className="text-typography-primary text-base">Vision & strategy</h3>
        <p className="text-typography-secondary mt-1 text-sm">
          The opportunity copilot reads this on every turn when someone files a new opportunity. It
          is how the copilot tells whether an idea fits where Ally is going, links it to a bet, and
          pushes back when it runs into a non-goal. Write it for a new teammate: plain, specific,
          and current.
        </p>
        {isEmpty && (
          <p className="text-typography-700 mt-2 text-sm">
            Nothing is written yet, so the copilot can only judge strategic fit against the strategy
            goals — and it will say so to the people filing.
          </p>
        )}
      </div>

      {FIELDS.map(field => (
        <div key={field.key} className="flex flex-col gap-1">
          <TextArea
            id={`strategy-${field.key}`}
            labelText={field.label}
            helperText={field.hint}
            rows={field.key === "bets" ? 6 : 4}
            value={draft[field.key]}
            maxLength={field.max}
            maxCount={field.max}
            enableCounter
            placeholder={field.placeholder}
            onChange={event => setDraft(prev => ({ ...prev, [field.key]: event.target.value }))}
          />
        </div>
      ))}

      <div className="flex flex-wrap items-center justify-end gap-3">
        <span className="text-typography-secondary text-xs" aria-live="polite">
          {isDirty
            ? "Unsaved changes"
            : page?.updatedAt
              ? `Last saved ${new Date(page.updatedAt).toLocaleDateString()}${
                  page.updatedByName ? ` by ${page.updatedByName}` : ""
                }`
              : ""}
        </span>
        {isDirty && (
          <Button
            variant={ButtonVariant.SECONDARY}
            onClick={() => setDraft(saved)}
            disabled={isSaving}
          >
            Discard
          </Button>
        )}
        <Button onClick={submit} disabled={!isDirty || isSaving}>
          {isSaving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
};
