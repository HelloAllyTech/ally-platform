import React, { useEffect, useRef, useState } from "react";

import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";

import { InlineNotification, SkeletonText } from "@ally-ui-mono/ui-shared";
import { Button } from "@components";
import { ChatComposer, ChatMessage } from "@components/agent-chat";
import { ButtonVariant } from "@components/types";
import { ROUTES } from "@constants";

import {
  AssistantCard,
  BuildingCard,
  DesignCards,
  LearnedCard,
  ReadingCard,
  SafetyCard,
  Section,
  ShareCard,
} from "./Canvas";
import { COPY, fill } from "./copy";
import { reached } from "./steps";
import { CanvasSection, useOnboardingSession } from "./useOnboardingSession";

const LG_QUERY = "(min-width: 1024px)";

/** Tailwind's `lg`: the canvas sits beside the chat above it, and is a tab below it. */
const useIsLargeScreen = (): boolean => {
  const [matches, setMatches] = useState(() =>
    typeof window === "undefined" || typeof window.matchMedia !== "function"
      ? true
      : window.matchMedia(LG_QUERY).matches,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return undefined;
    const query = window.matchMedia(LG_QUERY);
    const onChange = () => setMatches(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return matches;
};

/**
 * Onboarding's session screen (chunk 20a). Presentation only: every decision and action is
 * `useOnboardingSession`, so the design pass can replace this file (and Canvas.tsx) and keep the
 * hooks. The builder chat sits on the left and the canvas on the right; on a phone they're tabs.
 */
export const OnboardingSession: React.FC = () => {
  const { draftId = "" } = useParams<{ draftId: string }>();
  const navigate = useNavigate();
  const isLarge = useIsLargeScreen();
  const s = useOnboardingSession(draftId, message => toast.error(message));
  const [tab, setTab] = useState<"chat" | "canvas">("chat");
  const [seenCanvas, setSeenCanvas] = useState(0);
  const feedRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const shownSection = useRef<CanvasSection | null | undefined>(undefined);

  useEffect(() => {
    if (tab === "canvas" || isLarge) setSeenCanvas(s.canvasVersion);
  }, [tab, isLarge, s.canvasVersion]);

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: "smooth" });
  }, [s.rows.length, s.streaming, s.working]);

  // When a step starts, bring its section into view (the canvas's own pane only) and move focus
  // to its heading, so it isn't left below a long "What we learned".
  useEffect(() => {
    if (!s.view) return undefined;
    if (shownSection.current === undefined) {
      shownSection.current = s.focusSection;
      return undefined;
    }
    if (!s.focusSection || shownSection.current === s.focusSection) return undefined;
    shownSection.current = s.focusSection;
    const timer = setTimeout(() => {
      const target = canvasRef.current?.querySelector<HTMLElement>(
        `[data-testid="canvas-${s.focusSection}"]`,
      );
      const pane = canvasRef.current?.parentElement;
      if (target && pane) {
        const top =
          target.getBoundingClientRect().top - pane.getBoundingClientRect().top + pane.scrollTop;
        pane.scrollTo({ top: Math.max(0, top - 16), behavior: "smooth" });
      }
      const heading = target?.querySelector<HTMLElement>("h3");
      heading?.setAttribute("tabindex", "-1");
      heading?.focus({ preventScroll: true });
    }, 250);
    return () => clearTimeout(timer);
  }, [s.view, s.focusSection]);

  const view = s.view;
  if (!view) {
    return (
      <div className="p-6">
        <SkeletonText paragraph lineCount={6} />
      </div>
    );
  }

  const chat = (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div ref={feedRef} className="flex-1 overflow-y-auto p-4" aria-live="polite">
        <div className="flex flex-col gap-3">
          {s.rows.map(row => (
            <ChatMessage
              key={row.id}
              message={{
                id: row.id,
                role: row.from === "owner" ? "user" : "assistant",
                content: row.text,
                suggestedActions: row.chips.map(chip => ({ label: chip, message: chip })),
              }}
              onAnswerQuestion={() => undefined}
              onSendSuggestion={s.chooseChip}
              disabled={s.sending}
            />
          ))}
          {s.note && <p className="text-center text-xs text-typography-500">{s.note.text}</p>}
          {s.sending && (
            <ChatMessage
              message={{
                id: "streaming",
                role: "assistant",
                content: s.streaming,
                isStreaming: true,
                toolNotes: s.working ? [s.working] : [],
              }}
              onAnswerQuestion={() => undefined}
              disabled
            />
          )}
          {s.error && (
            <InlineNotification kind="error" lowContrast hideCloseButton title={s.error} />
          )}
        </div>
      </div>
      {s.questionsLeft ? (
        <p className="px-4 pb-1 text-xs text-typography-600">
          {fill(COPY.gaps.left, { n: s.questionsLeft })}
        </p>
      ) : null}
      <ChatComposer
        onSend={s.say}
        onStop={s.stop}
        isStreaming={s.sending}
        disabled={view.status !== "active"}
      />
    </section>
  );

  const render: Record<CanvasSection, () => React.ReactNode> = {
    reading: () => <ReadingCard view={view} reading={s.reading} />,
    learned: () => (
      <LearnedCard view={view} busy={s.sending} onPatch={s.edit} onConfirm={s.confirmLearned} />
    ),
    safety: () => <SafetyCard view={view} />,
    designs: () => (
      <DesignCards
        designs={view.designs ?? []}
        chosen={view.draft.design}
        canChoose={s.canChooseDesign}
        onChoose={id => {
          const card = view.designs?.find(d => d.id === id);
          if (card) s.chooseDesign(card);
        }}
      />
    ),
    building: () => <BuildingCard done={reached(view.step, "share")} />,
    assistant: () => <AssistantCard view={view} onPatch={s.edit} />,
    share: () => (
      <ShareCard
        view={view}
        publicAllowed={s.publicAllowed}
        published={s.published}
        publishing={s.publishing}
        onPublish={(access, emails) => void s.publish(access, emails)}
        onConnectWhatsApp={() =>
          navigate(`${ROUTES.CHATBOT_DETAIL.replace(":botId", view.chatbotId!)}?tab=connectors`)
        }
      />
    ),
  };

  const canvas = (
    <div ref={canvasRef} className="flex flex-col gap-4 p-4">
      {s.sections.map(id => (
        <Section key={id} id={id}>
          {render[id]()}
        </Section>
      ))}
    </div>
  );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex items-center justify-between gap-3 border-b border-neutral-200 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            variant={ButtonVariant.TEXT}
            aria-label={COPY.problems.leaving}
            onClick={() => navigate(ROUTES.WHATSAPP_BOT)}
          >
            ←
          </Button>
          <h1 className="truncate text-base font-semibold text-typography-900">{COPY.header}</h1>
        </div>
        {s.canGoBack && (
          <Button variant={ButtonVariant.SECONDARY} onClick={() => void s.back()}>
            {COPY.back}
          </Button>
        )}
      </header>

      {isLarge ? (
        <div className="flex min-h-0 flex-1">
          <div className="flex w-[40%] min-w-[360px] flex-col border-r border-neutral-200">
            {chat}
          </div>
          <aside className="flex-1 overflow-y-auto bg-neutral-50">{canvas}</aside>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div role="tablist" className="flex border-b border-neutral-200">
            {(["chat", "canvas"] as const).map(id => (
              <button
                key={id}
                role="tab"
                type="button"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={`relative flex-1 py-2 text-sm ${
                  tab === id
                    ? "border-b-2 border-primary-600 font-semibold text-typography-900"
                    : "text-typography-600"
                }`}
              >
                {COPY.tabs[id]}
                {id === "canvas" && tab !== "canvas" && s.canvasVersion > seenCanvas && (
                  <span
                    data-testid="canvas-badge"
                    className="absolute ml-1 inline-block h-2 w-2 rounded-full bg-primary-600"
                  />
                )}
              </button>
            ))}
          </div>
          <div className={tab === "chat" ? "flex min-h-0 flex-1" : "hidden"}>{chat}</div>
          {tab === "canvas" && <div className="flex-1 overflow-y-auto">{canvas}</div>}
        </div>
      )}
    </div>
  );
};
