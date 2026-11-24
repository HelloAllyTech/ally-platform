import React, { useCallback, useEffect, useRef, useState } from "react";

import { toast } from "sonner";

import {
  useAbandonRoleplayInterviewMutation,
  useApproveRoleplayInterviewMutation,
  useGetRoleplayInterviewMutation,
  useLinkRoleplayInterviewMutation,
  useOpenRoleplayInterviewMutation,
} from "@api";
import { en } from "@constants";
import {
  RoleplayInterviewBrief,
  RoleplayInterviewGeneration,
  RoleplayInterviewPlan,
  RoleplayInterviewSession,
} from "@types";

import { useRoleplayInterviewStream } from "../../hooks/useRoleplayInterviewStream";
import { AgentAnswerPayload, AgentReceipt, ChatComposer, ChatMessage } from "../agent-chat";
import { RoleplayBriefPanel } from "./RoleplayBriefPanel";
import { RoleplayPlanCard } from "./RoleplayPlanCard";

interface RoleplayInterviewPanelProps {
  /** The roleplay being edited, once it has been saved: the interview is kept with it. */
  scenarioId?: number | null;
  /** The plan was approved: build the roleplay from these inputs. */
  onApproved: (generation: RoleplayInterviewGeneration, sessionId: string) => void;
  /** Use the six quick steps instead. */
  onUseSteps?: () => void;
  /** The form is beside the panel: stack the brief above the chat instead of beside it. */
  compact?: boolean;
}

/**
 * The roleplay interview, Course Copilot's way for one roleplay: the agent asks one choice
 * question at a time and fills the brief beside the chat; when nothing is still needed it
 * proposes a plan, and approving it builds the roleplay into the form.
 */
export const RoleplayInterviewPanel: React.FC<RoleplayInterviewPanelProps> = ({
  scenarioId,
  onApproved,
  onUseSteps,
  compact = false,
}) => {
  const strings = en.roleplayInterview;
  const [session, setSession] = useState<RoleplayInterviewSession | null>(null);
  const [brief, setBrief] = useState<RoleplayInterviewBrief>({});
  const [stillNeeded, setStillNeeded] = useState<string[]>([]);
  const [plan, setPlan] = useState<{ plan: RoleplayInterviewPlan; version: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [openSession] = useOpenRoleplayInterviewMutation();
  const [getSession] = useGetRoleplayInterviewMutation();
  const [approve, { isLoading: approving }] = useApproveRoleplayInterviewMutation();
  const [link] = useLinkRoleplayInterviewMutation();
  const [abandon] = useAbandonRoleplayInterviewMutation();
  const feedEndRef = useRef<HTMLDivElement>(null);

  const adopt = useCallback((next: RoleplayInterviewSession) => {
    setSession(next);
    setBrief(next.brief ?? {});
    setStillNeeded(next.stillNeeded ?? []);
    setPlan(next.plan ? { plan: next.plan, version: next.planVersion } : null);
  }, []);

  const { messages, isStreaming, send, stop, hydrate, reset } = useRoleplayInterviewStream({
    sessionId: session?.id ?? null,
    onBrief: (nextBrief, nextStillNeeded) => {
      setBrief(nextBrief);
      setStillNeeded(nextStillNeeded);
      // A changed brief retires the plan it was made from.
      setPlan(previous => (previous ? null : previous));
    },
    onPlan: (nextPlan, version) => setPlan({ plan: nextPlan, version }),
  });

  // Open (or resume) the interview for this roleplay.
  const openedRef = useRef(false);
  useEffect(() => {
    if (openedRef.current) return;
    openedRef.current = true;
    (async () => {
      try {
        const opened = await openSession(scenarioId ? { scenarioId } : {}).unwrap();
        const detail = await getSession(opened.id).unwrap();
        adopt(detail.session);
        hydrate(detail.messages ?? []);
      } catch {
        toast.error(strings.openFailed);
      } finally {
        setLoading(false);
      }
    })();
  }, [adopt, getSession, hydrate, openSession, scenarioId, strings.openFailed]);

  // Keep the interview with the roleplay once the roleplay has been saved.
  useEffect(() => {
    if (session && scenarioId && session.scenarioId !== scenarioId) {
      void link({ id: session.id, scenarioId })
        .unwrap()
        .then(adopt)
        .catch(() => undefined);
    }
  }, [adopt, link, scenarioId, session]);

  useEffect(() => {
    feedEndRef.current?.scrollIntoView?.({ block: "end" });
  }, [messages.length, plan]);

  const handleAnswer = (payload: AgentAnswerPayload) =>
    send(payload.message, { questionId: payload.questionId, answer: payload.answer });

  const handleApprove = async () => {
    if (!session || !plan) return;
    try {
      const approved = await approve({ id: session.id, planVersion: plan.version }).unwrap();
      adopt(approved.session);
      onApproved(approved.generation, approved.session.id);
    } catch (caught) {
      const status = (caught as { status?: number })?.status;
      toast.error(status === 409 ? strings.planChanged : strings.approveFailed);
    }
  };

  const handleStartOver = async () => {
    if (!session) return;
    try {
      await abandon(session.id).unwrap();
      const fresh = await openSession(scenarioId ? { scenarioId } : {}).unwrap();
      adopt(fresh);
      reset();
    } catch {
      toast.error(strings.openFailed);
    }
  };

  const started = messages.length > 0;
  const approved = session?.status === "APPROVED";

  const chat = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar flex flex-col gap-3 pb-3">
        {!started && !loading && (
          <div
            className="rounded-lg bg-background-secondary px-4 py-3 text-sm text-typography-700"
            data-testid="interview-welcome"
          >
            <p>{strings.welcome}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {en.agentBuilderSuggestions.ideas.map(idea => (
                <button
                  key={idea.label}
                  type="button"
                  title={idea.text}
                  onClick={() => void send(idea.text)}
                  className="rounded-full border border-border-light bg-white px-3 py-1 text-xs text-typography-800 hover:border-primary hover:bg-primary-50"
                >
                  {idea.label}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map(message => (
          <div key={message.id} className="flex flex-col gap-1">
            <ChatMessage
              message={message}
              onAnswerQuestion={handleAnswer}
              disabled={isStreaming || approved}
            />
            {message.role === "assistant" && (message as { receipt?: unknown }).receipt ? (
              <AgentReceipt receipt={(message as { receipt?: unknown }).receipt} />
            ) : null}
          </div>
        ))}
        {plan && (
          <RoleplayPlanCard
            plan={plan.plan}
            onApprove={approved ? undefined : handleApprove}
            approving={approving}
            approved={approved}
          />
        )}
        <div ref={feedEndRef} />
      </div>
      {!approved && (
        <div className="shrink-0 border-t border-border-light pt-3">
          <ChatComposer
            onSend={text => void send(text)}
            onStop={stop}
            isStreaming={isStreaming}
            disabled={loading || !session}
            placeholder={started ? strings.placeholder : strings.firstPlaceholder}
          />
          <div className="mt-2 flex items-center justify-between text-xs text-typography-600">
            {onUseSteps ? (
              <button type="button" onClick={onUseSteps} className="hover:underline">
                {strings.useSteps}
              </button>
            ) : (
              <span />
            )}
            {started && (
              <button
                type="button"
                onClick={() => void handleStartOver()}
                className="hover:underline"
              >
                {strings.startOver}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div
      className={`flex h-full min-h-0 gap-6 ${compact ? "flex-col" : "flex-col lg:flex-row"}`}
      data-testid="roleplay-interview"
    >
      <div className={`flex min-h-0 flex-col ${compact ? "flex-1" : "flex-1 lg:basis-3/5"}`}>
        {chat}
      </div>
      <div
        className={
          compact
            ? "shrink-0 max-h-48 overflow-y-auto custom-scrollbar rounded border border-border-light p-3"
            : "shrink-0 lg:basis-2/5 lg:border-l lg:border-border-light lg:pl-6 overflow-y-auto custom-scrollbar"
        }
      >
        <RoleplayBriefPanel brief={brief} stillNeeded={stillNeeded} />
      </div>
    </div>
  );
};
