import React, { useCallback, useEffect, useId, useRef, useState } from "react";

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
import { LanguageVoiceChoice, LanguageVoicePicker } from "./LanguageVoicePicker";
import { RoleplayBriefPanel } from "./RoleplayBriefPanel";
import { RoleplayPlanCard } from "./RoleplayPlanCard";

const PANEL_TABS = ["build", "brief"] as const;
type PanelTab = (typeof PANEL_TABS)[number];

interface RoleplayInterviewPanelProps {
  /** The roleplay being edited, once it has been saved: the interview is kept with it. */
  scenarioId?: number | null;
  /** The plan was approved: build the roleplay from these inputs. */
  onApproved: (
    generation: RoleplayInterviewGeneration,
    sessionId: string,
    /** The trainer's languages and voices from the Brief tab (languageId → voiceId, "" = agent). */
    languageVoices: LanguageVoiceChoice,
  ) => void;
  /** Use the six quick steps instead. */
  onUseSteps?: () => void;
  /** Kept for callers; the tabs work the same beside the form. */
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
  const [tab, setTab] = useState<PanelTab>("build");
  // Languages and voices: start from what the agent recorded, until the trainer changes them.
  const [languageVoices, setLanguageVoices] = useState<LanguageVoiceChoice>({});
  const [languagesTouched, setLanguagesTouched] = useState(false);
  useEffect(() => {
    if (languagesTouched) return;
    setLanguageVoices(previous =>
      Object.fromEntries(
        (brief.languages ?? []).map(l => [l.languageId, previous[l.languageId] ?? ""]),
      ),
    );
  }, [brief.languages, languagesTouched]);
  // The brief changed while the trainer was in the chat: a dot on the Brief tab.
  const [briefUnseen, setBriefUnseen] = useState(false);
  const tabRefs = useRef<Partial<Record<PanelTab, HTMLButtonElement | null>>>({});
  const idPrefix = useId();
  const selectTab = (next: PanelTab) => {
    setTab(next);
    if (next === "brief") setBriefUnseen(false);
  };

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
      setBriefUnseen(true);
      // A changed brief retires the plan it was made from.
      setPlan(previous => (previous ? null : previous));
    },
    onPlan: (nextPlan, version) => {
      setPlan({ plan: nextPlan, version });
      setBriefUnseen(true);
    },
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
      onApproved(approved.generation, approved.session.id, languageVoices);
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
          <div
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-primary-200 bg-primary-50 px-4 py-3 text-sm"
            data-testid="plan-notice"
          >
            <span className="text-typography-900">
              {approved ? strings.tabs.planApproved : strings.tabs.planReady(plan.plan.title)}
            </span>
            <span className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => selectTab("brief")}
                className="text-primary-700 underline"
              >
                {strings.tabs.reviewPlan}
              </button>
              <button
                type="button"
                onClick={() => selectTab("brief")}
                className="text-primary-700 underline"
              >
                {strings.voices.chooseLink}
              </button>
              {!approved && (
                <button
                  type="button"
                  onClick={() => void handleApprove()}
                  disabled={approving}
                  className="rounded bg-primary px-3 py-1.5 text-white disabled:opacity-60"
                >
                  {approving ? strings.plan.approving : strings.plan.approve}
                </button>
              )}
            </span>
          </div>
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

  const tabIds = (tab: PanelTab) => ({
    tab: `${idPrefix}-tab-${tab}`,
    panel: `${idPrefix}-panel-${tab}`,
  });
  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = PANEL_TABS.indexOf(tab);
    const next =
      event.key === "Home"
        ? PANEL_TABS[0]
        : event.key === "End"
          ? PANEL_TABS[PANEL_TABS.length - 1]
          : PANEL_TABS[
              (index + (event.key === "ArrowRight" ? 1 : -1) + PANEL_TABS.length) %
                PANEL_TABS.length
            ];
    selectTab(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="roleplay-interview">
      {/* Course Copilot's two panes for one roleplay: Build is the chat, Brief what it has
          gathered and the plan to approve. A dot marks the pane that changed out of sight. */}
      <div
        role="tablist"
        aria-label={strings.tabs.label}
        onKeyDown={handleTabKeyDown}
        className="flex shrink-0 gap-1 border-b border-neutral-200"
      >
        {PANEL_TABS.map(name => {
          const isActive = name === tab;
          return (
            <button
              key={name}
              ref={node => {
                tabRefs.current[name] = node;
              }}
              id={tabIds(name).tab}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={tabIds(name).panel}
              tabIndex={isActive ? 0 : -1}
              onClick={() => selectTab(name)}
              className={`-mb-px inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500 ${
                isActive
                  ? "border-primary-500 font-medium text-primary-700"
                  : "border-transparent text-typography-800 hover:text-typography-900"
              }`}
            >
              {strings.tabs[name]}
              {name === "brief" && briefUnseen && (
                <span
                  role="img"
                  aria-label={strings.tabs.updated}
                  title={strings.tabs.updated}
                  className="inline-block h-1.5 w-1.5 rounded-full bg-primary-500"
                />
              )}
              {name === "brief" && stillNeeded.length > 0 && (
                <span className="rounded-full bg-amber-100 px-1.5 text-[11px] text-amber-900">
                  {strings.tabs.neededCount(stillNeeded.length)}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div
        role="tabpanel"
        id={tabIds(tab).panel}
        aria-labelledby={tabIds(tab).tab}
        className={`flex min-h-0 flex-1 flex-col pt-3 ${tab === "brief" ? "overflow-y-auto custom-scrollbar" : ""}`}
      >
        {tab === "build" ? (
          chat
        ) : (
          <div className="flex flex-col gap-4 pb-4">
            <RoleplayBriefPanel brief={brief} stillNeeded={stillNeeded} />
            <LanguageVoicePicker
              value={languageVoices}
              disabled={approved}
              onChange={next => {
                setLanguagesTouched(true);
                setLanguageVoices(next);
              }}
            />
            {plan ? (
              <RoleplayPlanCard
                plan={plan.plan}
                onApprove={approved ? undefined : handleApprove}
                approving={approving}
                approved={approved}
              />
            ) : (
              <p className="text-sm text-typography-600">{strings.tabs.noPlanYet}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
