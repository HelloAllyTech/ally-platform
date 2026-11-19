import React, { useState } from "react";

import { toast } from "sonner";

import { Button, TextArea, Tooltip } from "@ally-ui-mono/ui-shared";
import { TooltipIcon } from "@assets";
import { en } from "@constants";
import type { BuilderServerMessage, RoadmapItemDetail } from "@types";

import { useSendRoadmapPlanMessageMutation } from "../../../api/roadmapPlanning";
import { haptic } from "../../../motion";
import { errorMessage, errorStatus } from "../drafts/draftUtils";

const MAX = 4000;

/** True once the plan agent has said anything on this idea. */
export const agentHasSpoken = (messages?: BuilderServerMessage[]): boolean =>
  (Array.isArray(messages) ? messages : []).some(m => {
    if (m.role !== "assistant") return false;
    const meta = (m.metadata ?? {}) as Record<string, unknown>;
    return (
      !!(m.content ?? "").trim() ||
      !!meta.situationBrief ||
      (Array.isArray(meta.questions) && meta.questions.length > 0) ||
      !!meta.streaming
    );
  });

/**
 * The planner's box (audit 2026-11-19, rec 1): an Owner, or the builder already assigned, writes
 * to the plan agent, and that starts its next turn. Separate from the comment box, which talks to
 * people and never starts a turn. Before the agent has said anything (an idea whose planning began
 * before Start planning queued an opening turn), it offers to start the agent instead.
 *
 * Hidden unless the server says `can.workPlan`.
 */
export const PlanComposer: React.FC<{
  item: Pick<RoadmapItemDetail, "code" | "sessionId" | "can">;
  messages?: BuilderServerMessage[];
}> = ({ item, messages }) => {
  const copy = en.roadmapV2.planGate;
  const [text, setText] = useState("");
  const [send, { isLoading }] = useSendRoadmapPlanMessageMutation();
  if (!item.can?.workPlan || !item.sessionId) return null;
  const sessionId = item.sessionId;
  const spoken = agentHasSpoken(messages);

  const submit = async (message: string) => {
    try {
      await send({ code: item.code, sessionId, text: message || undefined }).unwrap();
      haptic(10);
      setText("");
      toast.success(copy.sent);
    } catch (error) {
      toast.error(
        errorStatus(error) === 409 ? copy.busy : (errorMessage(error) ?? copy.sendFailed),
      );
    }
  };

  return (
    <section
      aria-label={copy.composerLabel}
      className="flex flex-col gap-2 rounded border border-border-light bg-neutral-50 p-3"
    >
      <div className="flex items-center gap-1">
        <h3 className="m-0 text-xs font-semibold text-typography-primary">{copy.composerLabel}</h3>
        <Tooltip label={copy.composerHelp} align="top">
          <button
            type="button"
            className="inline-flex cursor-pointer items-center"
            aria-label={copy.composerHelp}
          >
            <TooltipIcon />
          </button>
        </Tooltip>
      </div>
      {!spoken && (
        <div className="flex items-center gap-1">
          <Button kind="tertiary" size="sm" disabled={isLoading} onClick={() => void submit("")}>
            {copy.startAgent}
          </Button>
          <Tooltip label={copy.startAgentHelp} align="top">
            <button
              type="button"
              className="inline-flex cursor-pointer items-center"
              aria-label={copy.startAgentHelp}
            >
              <TooltipIcon />
            </button>
          </Tooltip>
        </div>
      )}
      <TextArea
        id={`plan-composer-${item.code}`}
        labelText={copy.composerLabel}
        hideLabel
        rows={3}
        value={text}
        placeholder={copy.composerPlaceholder}
        onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) =>
          setText(event.target.value.slice(0, MAX))
        }
        onKeyDown={(event: React.KeyboardEvent<HTMLTextAreaElement>) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && text.trim()) {
            event.preventDefault();
            void submit(text.trim());
          }
        }}
      />
      <div className="flex justify-end">
        <Button
          kind="primary"
          size="sm"
          disabled={isLoading || !text.trim()}
          onClick={() => void submit(text.trim())}
        >
          {isLoading ? copy.sending : copy.send}
        </Button>
      </div>
    </section>
  );
};
