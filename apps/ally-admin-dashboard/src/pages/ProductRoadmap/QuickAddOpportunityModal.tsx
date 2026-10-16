import React, { useMemo, useState } from "react";

import { Close } from "@icons";
import { toast } from "sonner";

import { CarbonDropdown, TextArea } from "@ally-ui-mono/ui-shared";
import { useQuickAddRoadmapOpportunityMutation } from "@api";
import { Button } from "@components";
import { ButtonVariant } from "@components/types";
import { RoadmapOpportunityEffort, RoadmapOpportunityType, RoadmapTaxonomyItem } from "@types";

import { EFFORT_LABEL } from "./utils/stages";

/** Smallest-first — EFFORT_LABEL's key order is the scale's order. */
const EFFORTS = Object.values(RoadmapOpportunityEffort);

interface QuickAddOpportunityModalProps {
  /** The product goals the board files under; the picker lists them by name. */
  goals: RoadmapTaxonomyItem[];
  onClose: () => void;
  /** Called with the new row's id once filed. The page opens it in the normal drawer. */
  onCreated: (id: string) => void;
}

/**
 * "Quick add" on the Product Roadmap — the plain form the guided interview replaced, back for a
 * named few.
 *
 * The interview exists so a draft reaches the board already sharpened; a curator who already
 * knows what belongs on it pays that cost for nothing. So this is three fields and a button:
 * what it is, which product goal it files under, and (optionally) how big it is. No readiness
 * check, no copilot, no brief — ally-be's `POST opportunities/quick` runs the same filing minus
 * the gate, and the server, not this form, decides who may call it (the
 * `product_roadmap_quick_add` toggle; see canQuickAddRoadmap).
 *
 * A centred dialog rather than the interview's 64rem side drawer: a three-field form in a
 * drawer that size is mostly empty, and the drawer width is there for the conversation and
 * the brief beside it, neither of which this has.
 *
 * Hands over the way the interview does — files, then closes and opens the normal drawer on the
 * new row, where editing and voting already live. No review step in between.
 */
export const QuickAddOpportunityModal: React.FC<QuickAddOpportunityModalProps> = ({
  goals,
  onClose,
  onCreated,
}) => {
  const [quickAdd, { isLoading: isFiling }] = useQuickAddRoadmapOpportunityMutation();

  const [description, setDescription] = useState("");
  const [productGoal, setProductGoal] = useState<string>("");
  const [effort, setEffort] = useState<RoadmapOpportunityEffort | "">("");

  const goalItems = useMemo(
    () => goals.map(goal => ({ value: goal.name, label: goal.name })),
    [goals],
  );
  const effortItems = useMemo(
    () => [
      { value: "", label: "Not sized" },
      ...EFFORTS.map(size => ({ value: size as string, label: EFFORT_LABEL[size] })),
    ],
    [],
  );

  const canSubmit = description.trim().length > 0 && productGoal !== "" && !isFiling;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    try {
      const created = await quickAdd({
        description: description.trim(),
        type: RoadmapOpportunityType.IDEA,
        productGoal,
        effort: effort || null,
      }).unwrap();
      toast.success("Added to the roadmap.");
      onCreated(created.id);
    } catch (error) {
      const message = (error as { data?: { message?: string | string[] } })?.data?.message;
      toast.error(
        (Array.isArray(message) ? message[0] : message) || "Could not add that opportunity.",
      );
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-add-title"
        className="bg-white flex w-[36rem] max-w-full flex-col"
        onClick={event => event.stopPropagation()}
      >
        <header className="border-border-light flex items-start justify-between gap-3 border-b p-4">
          <div className="min-w-0">
            <h2 id="quick-add-title" className="text-typography-primary text-lg">
              Quick add
            </h2>
            <p className="text-typography-700 text-xs">
              Goes straight onto the board, with no readiness check. You can edit it in the drawer
              afterwards.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-typography-secondary hover:text-typography-900 -m-2 inline-flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center md:m-0 md:block md:h-auto md:w-auto"
          >
            <Close />
          </button>
        </header>

        <div className="flex flex-col gap-4 p-4">
          <TextArea
            id="quick-add-description"
            labelText="What is the opportunity?"
            placeholder="Example: Let a supervisor export a cohort's scores as a spreadsheet."
            rows={4}
            value={description}
            onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) =>
              setDescription(event.target.value)
            }
          />

          <CarbonDropdown
            id="quick-add-product-goal"
            titleText="Product goal"
            label="Choose a product goal"
            items={goalItems}
            itemToString={item => item?.label ?? ""}
            selectedItem={goalItems.find(item => item.value === productGoal) ?? null}
            onChange={({ selectedItem }) => setProductGoal(selectedItem?.value ?? "")}
          />

          <CarbonDropdown
            id="quick-add-effort"
            titleText="Size (optional)"
            label="Not sized"
            items={effortItems}
            itemToString={item => item?.label ?? ""}
            selectedItem={effortItems.find(item => item.value === effort) ?? effortItems[0]}
            onChange={({ selectedItem }) =>
              setEffort((selectedItem?.value ?? "") as RoadmapOpportunityEffort | "")
            }
          />
        </div>

        <footer className="border-border-light flex justify-end gap-2 border-t p-4">
          <Button variant={ButtonVariant.SECONDARY} onClick={onClose} disabled={isFiling}>
            Cancel
          </Button>
          <Button variant={ButtonVariant.PRIMARY} onClick={handleSubmit} disabled={!canSubmit}>
            {isFiling ? "Adding…" : "Add to roadmap"}
          </Button>
        </footer>
      </div>
    </div>
  );
};
