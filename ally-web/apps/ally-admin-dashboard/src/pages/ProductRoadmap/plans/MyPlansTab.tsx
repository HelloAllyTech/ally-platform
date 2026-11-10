import React, { useState } from "react";

import { toast } from "sonner";

import { SkeletonText } from "@ally-ui-mono/ui-shared";
import {
  useGetMyPlansQuery,
  useGetPlanNotificationsQuery,
  useMarkPlanNotificationsReadMutation,
  useStartPlanMutation,
} from "@api";
import { Button, EmptyState } from "@components";
import { ButtonVariant } from "@components/types";

import { errorMessage } from "./planLabels";
import { PlanProgress } from "./PlanProgress";

interface MyPlansTabProps {
  /** Whether the viewer may park and file ideas (VOTE + Product Planning — Ideas). */
  canFile: boolean;
  onOpen: (planId: string) => void;
}

const IDEA_MAX = 4000;

/**
 * My ideas (rev 5.2 §B.4): the viewer's private ideas and the plans they filed, plus their plan
 * updates. A new idea is either parked (saved, no AI, no cost) or worked up with the copilot.
 */
export const MyPlansTab: React.FC<MyPlansTabProps> = ({ canFile, onOpen }) => {
  const { data: plans, isLoading } = useGetMyPlansQuery();
  const { data: notifications } = useGetPlanNotificationsQuery();
  const [markRead] = useMarkPlanNotificationsReadMutation();
  const [startPlan, { isLoading: isStarting }] = useStartPlanMutation();
  const [text, setText] = useState("");

  const start = async (park: boolean) => {
    const idea = text.trim();
    if (!idea) return;
    try {
      const plan = await startPlan({ text: idea, park }).unwrap();
      setText("");
      if (park) toast.success("Parked. Only you can see it until you file it.");
      else onOpen(plan.id);
    } catch (error) {
      toast.error(errorMessage(error, "Could not save that idea."));
    }
  };

  const unread = (notifications ?? []).filter(n => !n.readAt);
  const drafts = (plans ?? []).filter(p => p.private);
  const filed = (plans ?? []).filter(p => !p.private);

  return (
    <div className="flex flex-col gap-6 py-4">
      {unread.length > 0 && (
        <section aria-label="Plan updates" className="border border-primary-200 bg-primary-50 p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Updates on your plans</h3>
            <button
              type="button"
              className="text-xs text-primary-600 underline"
              onClick={() =>
                markRead({})
                  .unwrap()
                  .catch(() => undefined)
              }
            >
              Mark all read
            </button>
          </div>
          <ul className="flex flex-col gap-2">
            {unread.slice(0, 10).map(n => (
              <li key={n.id} className="flex items-start justify-between gap-4 text-sm">
                <button
                  type="button"
                  className="text-left hover:underline"
                  onClick={() => onOpen(n.sessionId)}
                >
                  {n.message}
                </button>
                <button
                  type="button"
                  className="shrink-0 text-xs text-typography-secondary underline"
                  onClick={() =>
                    markRead({ id: n.id })
                      .unwrap()
                      .catch(() => undefined)
                  }
                >
                  Dismiss
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {canFile && (
        <section aria-label="Start an idea" className="flex flex-col gap-2">
          <label htmlFor="new-plan-idea" className="text-sm font-semibold">
            New idea
          </label>
          <textarea
            id="new-plan-idea"
            className="min-h-24 w-full border border-gray-300 p-3 text-sm"
            maxLength={IDEA_MAX}
            placeholder="What's the idea? Rough is fine — who is struggling, and with what?"
            value={text}
            onChange={event => setText(event.target.value)}
          />
          <div className="flex gap-2">
            <Button
              variant={ButtonVariant.SECONDARY}
              disabled={!text.trim() || isStarting}
              onClick={() => start(true)}
            >
              Park it
            </Button>
            <Button disabled={!text.trim() || isStarting} onClick={() => start(false)}>
              Work it up
            </Button>
          </div>
          <p className="text-xs text-typography-secondary">
            Ideas you park or work on stay private until you file them. Quiet ideas are archived
            after 30 days and deleted 60 days later, with a warning first.
          </p>
        </section>
      )}

      <section aria-label="Your ideas" className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Your ideas</h3>
        {isLoading && <SkeletonText paragraph lineCount={3} />}
        {!isLoading && drafts.length === 0 && (
          <EmptyState
            title="No ideas yet"
            subtitle="Ideas you park or start working on live here. Only you can see them until you file."
            hideActionButton
          />
        )}
        <ul className="flex flex-col divide-y divide-gray-100">
          {drafts.map(p => (
            <li key={p.id} className="flex items-center justify-between gap-4 py-3">
              <button
                type="button"
                className="text-left text-sm hover:underline"
                onClick={() => onOpen(p.id)}
              >
                {p.title}
              </button>
              <span className="shrink-0 text-xs text-typography-secondary">
                {p.archivedAt ? "Archived" : p.parked ? "Parked" : "In progress"}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {filed.length > 0 && (
        <section aria-label="Plans you filed" className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Plans you filed</h3>
          <ul className="flex flex-col divide-y divide-gray-100">
            {filed.map(p => (
              <li key={p.id} className="flex items-center justify-between gap-4 py-3">
                <button
                  type="button"
                  className="text-left text-sm hover:underline"
                  onClick={() => onOpen(p.id)}
                >
                  {p.title}
                </button>
                <PlanProgress stage={p.stage} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
};
