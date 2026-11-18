import React from "react";

import { toast } from "sonner";

import { SkeletonText } from "@ally-ui-mono/ui-shared";
import {
  useDismissPlanSignalMutation,
  useGetPlanSignalsQuery,
  useWorkUpPlanSignalMutation,
} from "@api";
import { Button, EmptyState } from "@components";
import { ButtonVariant } from "@components/types";

import { errorMessage } from "./planLabels";

interface SignalsTabProps {
  onOpen: (planId: string) => void;
}

/**
 * Signals (rev 5.2 §B.8.3): ideas the weekly scout suggests from aggregated product signals.
 * Nothing here is filed by the agent. Working one up starts a private idea for you; dismissing
 * one keeps it quiet for 90 days.
 */
export const SignalsTab: React.FC<SignalsTabProps> = ({ onOpen }) => {
  const { data, isLoading } = useGetPlanSignalsQuery();
  const [dismiss] = useDismissPlanSignalMutation();
  const [workUp, { isLoading: isWorking }] = useWorkUpPlanSignalMutation();

  if (isLoading) return <SkeletonText paragraph lineCount={4} />;
  const rows = data ?? [];
  if (!rows.length) {
    return (
      <EmptyState
        title="No suggestions this week"
        subtitle="The scout looks at product signals once a week and suggests ideas worth a look."
        hideActionButton
      />
    );
  }
  return (
    <ul className="flex flex-col gap-4 py-4">
      {rows.map(s => (
        <li key={s.id} className="border border-gray-200 p-4">
          <h3 className="text-sm font-semibold">{s.title}</h3>
          <p className="mt-1 text-sm">{s.problem}</p>
          <p className="mt-1 text-xs text-typography-secondary">
            Who: {s.who} · Why now: {s.whyNow}
          </p>
          {s.evidence.length > 0 && (
            <p className="mt-1 text-xs text-typography-secondary">
              Evidence: {s.evidence.join(", ")}
            </p>
          )}
          <div className="mt-3 flex gap-2">
            <Button
              disabled={isWorking}
              onClick={async () => {
                try {
                  const plan = await workUp(s.id).unwrap();
                  onOpen(plan.id);
                } catch (error) {
                  toast.error(errorMessage(error, "Could not start an idea from that."));
                }
              }}
            >
              Work it up
            </Button>
            <Button
              variant={ButtonVariant.SECONDARY}
              onClick={() =>
                dismiss(s.id)
                  .unwrap()
                  .catch(() => toast.error("Could not dismiss that."))
              }
            >
              Dismiss
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
};
