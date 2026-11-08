import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";

import { InlineNotification, SkeletonText } from "@ally-ui-mono/ui-shared";
import {
  useBackBotDraftMutation,
  useGetBotPageQuery,
  usePatchBotDraftMutation,
  usePublishBotDraftMutation,
} from "@api";
import { Button } from "@components";
import { ChatComposer, ChatMessage } from "@components/agent-chat";
import { ButtonVariant } from "@components/types";
import { ROUTES } from "@constants";
import type { AgentChatMessage } from "@types";

import {
  AssistantCard,
  BuildingCard,
  DesignCards,
  LearnedCard,
  ReadingCard,
  SafetyCard,
  Section,
  ShareCard,
  reached,
} from "./Canvas";
import { COPY, fill } from "./copy";
import { useBotDraftSession } from "./useBotDraftSession";

import type { PatchOp, PublishResult } from "./types";

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

const errorText = (error: unknown): string => {
  const data = (error as { data?: { message?: unknown } })?.data;
  return typeof data?.message === "string" ? data.message : COPY.problems.generic;
};

/**
 * Onboarding (chunk 20a): the builder chat on the left and the canvas on the right, where
 * everything the builder finds and makes appears, section by section, as its step starts. On a
 * phone the two are tabs, and the canvas tab shows a dot when it changed out of sight. The canvas
 * is mounted once (never hidden with CSS), so edits in it are never lost to a second copy.
 */
export const OnboardingSession: React.FC = () => {
  const { draftId = "" } = useParams<{ draftId: string }>();
  const navigate = useNavigate();
  const isLarge = useIsLargeScreen();
  const session = useBotDraftSession(draftId);
  const { view, reading, working, streaming, sending, error, send, setView, canvasVersion } =
    session;
  const [tab, setTab] = useState<"chat" | "canvas">("chat");
  const [seenCanvas, setSeenCanvas] = useState(0);
  const [published, setPublished] = useState<PublishResult | null>(null);
  const [patchDraft] = usePatchBotDraftMutation();
  const [back, { isLoading: goingBack }] = useBackBotDraftMutation();
  const [publish, { isLoading: publishing }] = usePublishBotDraftMutation();
  const { data: page } = useGetBotPageQuery(view?.chatbotId ?? "", {
    skip: !view?.chatbotId,
  });
  const feedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (tab === "canvas" || isLarge) setSeenCanvas(canvasVersion);
  }, [tab, isLarge, canvasVersion]);

  // A published draft opened again shows its live link.
  useEffect(() => {
    if (view?.status === "published" && page?.link && !published && view.chatbotId) {
      setPublished({
        chatbotId: view.chatbotId,
        slug: page.slug,
        link: page.link,
        access: page.access as PublishResult["access"],
      });
    }
  }, [view, page, published]);

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: "smooth" });
  }, [view?.transcript.length, streaming, working]);

  const onPatch = useCallback(
    async (target: "draft" | "learned", ops: PatchOp[]): Promise<boolean> => {
      if (!view) return false;
      try {
        setView(await patchDraft({ id: view.id, target, ops, version: view.version }).unwrap());
        return true;
      } catch (err) {
        toast.error(errorText(err));
        void session.reload();
        return false;
      }
    },
    [patchDraft, session, setView, view],
  );

  const messages = useMemo<AgentChatMessage[]>(() => {
    if (!view) return [];
    const rows = view.transcript.filter(entry => entry.role !== "note");
    const lastBuilder = [...rows].reverse().find(e => e.role === "builder")?.id;
    return rows.map(entry => ({
      id: entry.id,
      role: entry.role === "owner" ? "user" : "assistant",
      content: entry.text,
      ...(entry.id === lastBuilder && entry.chips?.length && !sending
        ? {
            suggestedActions: entry.chips.map(chip => ({ label: chip, message: chip })),
          }
        : {}),
    }));
  }, [view, sending]);

  if (!view) {
    return (
      <div className="p-6">
        <SkeletonText paragraph lineCount={6} />
      </div>
    );
  }

  const step = view.step;
  const notes = view.transcript.filter(entry => entry.role === "note");
  const questionsLeft = step === "gaps" ? view.conversation.questionsLeft : null;
  const canGoBack = reached(step, "safety") && step !== "published" && !sending;
  const building = step === "building" || (sending && working === COPY.working.drafting);

  const chat = (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div ref={feedRef} className="flex-1 overflow-y-auto p-4" aria-live="polite">
        <div className="flex flex-col gap-3">
          {messages.map(message => (
            <ChatMessage
              key={message.id}
              message={message}
              onAnswerQuestion={() => undefined}
              onSendSuggestion={chip => void send({ chip })}
              disabled={sending}
            />
          ))}
          {notes.slice(-1).map(note => (
            <p key={note.id} className="text-center text-xs text-typography-500">
              {note.text}
            </p>
          ))}
          {sending && (
            <ChatMessage
              message={{
                id: "streaming",
                role: "assistant",
                content: streaming,
                isStreaming: true,
                toolNotes: working ? [working] : [],
              }}
              onAnswerQuestion={() => undefined}
              disabled
            />
          )}
          {error && <InlineNotification kind="error" lowContrast hideCloseButton title={error} />}
        </div>
      </div>
      {questionsLeft ? (
        <p className="px-4 pb-1 text-xs text-typography-600">
          {fill(COPY.gaps.left, { n: questionsLeft })}
        </p>
      ) : null}
      <ChatComposer
        onSend={text => void send({ text })}
        onStop={() => undefined}
        isStreaming={sending}
        disabled={view.status !== "active"}
      />
    </section>
  );

  const canvas = (
    <div className="flex flex-col gap-4 p-4">
      {view.source.website && (
        <Section id="reading">
          <ReadingCard view={view} reading={reading} />
        </Section>
      )}
      {reached(step, "learned") && (
        <Section id="learned">
          <LearnedCard
            view={view}
            busy={sending}
            onPatch={onPatch}
            onConfirm={() => void send({ chip: COPY.learned.confirm })}
          />
        </Section>
      )}
      {view.safety?.on && (
        <Section id="safety">
          <SafetyCard view={view} />
        </Section>
      )}
      {view.designs && reached(step, "design") && (
        <Section id="designs">
          <DesignCards
            designs={view.designs}
            chosen={view.draft.design}
            canChoose={step === "design" && !sending}
            onChoose={id => void send({ chip: `design:${id}` })}
          />
        </Section>
      )}
      {(building || reached(step, "share")) && (
        <Section id="building">
          <BuildingCard done={reached(step, "share")} />
        </Section>
      )}
      {reached(step, "share") && (
        <Section id="assistant">
          <AssistantCard view={view} onPatch={onPatch} />
        </Section>
      )}
      {reached(step, "share") && (
        <Section id="share">
          <ShareCard
            view={view}
            publicAllowed={Boolean(page?.publicAllowed)}
            published={published}
            publishing={publishing}
            onPublish={async (access, emails) => {
              try {
                setPublished(await publish({ id: view.id, access, emails }).unwrap());
                void session.reload();
              } catch (err) {
                toast.error(errorText(err));
              }
            }}
            onConnectWhatsApp={() =>
              navigate(`${ROUTES.CHATBOT_DETAIL.replace(":botId", view.chatbotId!)}?tab=connectors`)
            }
          />
        </Section>
      )}
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
        {canGoBack && (
          <Button
            variant={ButtonVariant.SECONDARY}
            disabled={goingBack}
            onClick={async () => setView(await back(view.id).unwrap())}
          >
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
                {id === "canvas" && tab !== "canvas" && canvasVersion > seenCanvas && (
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
