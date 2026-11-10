import React from "react";

import { toast } from "sonner";

import { SkeletonText } from "@ally-ui-mono/ui-shared";
import { useGetPlanQueueQuery, useTakeOnPlanMutation } from "@api";
import { Button, EmptyState } from "@components";

import { errorMessage } from "./planLabels";

interface LeadQueueTabProps {
  onOpen: (planId: string) => void;
}

/**
 * Needs a lead (rev 5.2 §B.5): filed plans nobody has taken on, most-voted first. Closes waiting
 * on a second Lead sit here too, so they cannot be missed.
 */
export const LeadQueueTab: React.FC<LeadQueueTabProps> = ({ onOpen }) => {
  const { data, isLoading } = useGetPlanQueueQuery();
  const [takeOn, { isLoading: isTaking }] = useTakeOnPlanMutation();

  const take = async (id: string) => {
    try {
      await takeOn(id).unwrap();
      onOpen(id);
    } catch (error) {
      toast.error(errorMessage(error, "Could not take that on."));
    }
  };

  if (isLoading) return <SkeletonText paragraph lineCount={4} />;
  const rows = data ?? [];
  if (!rows.length) {
    return (
      <EmptyState
        title="Nothing needs a lead"
        subtitle="Filed ideas appear here until someone takes them on."
        hideActionButton
      />
    );
  }
  return (
    <ul className="flex flex-col divide-y divide-gray-100 py-4">
      {rows.map(row => (
        <li key={row.id} className="flex items-center justify-between gap-4 py-3">
          <div className="flex flex-col">
            <button
              type="button"
              className="text-left text-sm hover:underline"
              onClick={() => onOpen(row.id)}
            >
              {row.title}
            </button>
            <span className="text-xs text-typography-secondary">
              {row.votes} vote{row.votes === 1 ? "" : "s"}
              {row.filedAt ? ` · filed ${row.filedAt.slice(0, 10)}` : ""}
              {row.awaitingCloseConfirmation ? " · close waiting for a second Lead" : ""}
            </span>
          </div>
          {row.awaitingCloseConfirmation ? (
            <Button onClick={() => onOpen(row.id)}>Review close</Button>
          ) : (
            <Button disabled={isTaking} onClick={() => take(row.id)}>
              Take this on
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
};
