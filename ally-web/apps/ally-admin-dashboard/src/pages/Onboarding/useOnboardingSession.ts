import { useCallback, useEffect, useMemo, useState } from "react";

import {
  useBackBotDraftMutation,
  useGetBotPageQuery,
  usePatchBotDraftMutation,
  usePublishBotDraftMutation,
} from "@api";

import { COPY } from "./copy";
import { reached } from "./steps";
import { BotDraftSession, ReadingProgress, useBotDraftSession } from "./useBotDraftSession";
import { errorText } from "./useOnboardingStart";

import type {
  BotDraftStep,
  BotDraftView,
  DesignCard,
  PatchOp,
  PublishResult,
  TranscriptEntry,
} from "./types";

export { reached };

/** The canvas sections, in order. */
export type CanvasSection =
  | "reading"
  | "learned"
  | "safety"
  | "designs"
  | "building"
  | "assistant"
  | "share";

/** The section a step brings into view as it starts. */
const STEP_SECTION: Partial<Record<BotDraftStep, CanvasSection>> = {
  learned: "learned",
  gaps: "safety",
  design: "designs",
  building: "building",
  share: "assistant",
  published: "share",
};

/** One row of the builder chat, as a screen draws it. */
export interface ChatRow {
  id: string;
  from: "builder" | "owner";
  text: string;
  /** Quick replies: only on the latest builder message, and not while it's working. */
  chips: string[];
}

export interface OnboardingSession {
  /** Null while the draft loads. */
  view: BotDraftView | null;
  reading: ReadingProgress;
  /** The chat, oldest first, and the latest note ("Updated your hours"), if any. */
  rows: ChatRow[];
  note: TranscriptEntry | null;
  /** While the builder works: what it's doing, and its reply so far. */
  sending: boolean;
  working: string | null;
  streaming: string;
  error: string | null;
  /** "{n} quick questions left", while there are questions. */
  questionsLeft: number | null;
  /** The canvas sections to show now, in order, and the one the current step just brought in. */
  sections: CanvasSection[];
  focusSection: CanvasSection | null;
  /** Whether the builder is writing the assistant (the building steps tick). */
  building: boolean;
  canGoBack: boolean;
  canChooseDesign: boolean;
  publicAllowed: boolean;
  published: PublishResult | null;
  publishing: boolean;
  /** Bumped when the canvas changed, for a phone's tab badge. */
  canvasVersion: number;

  say: (text: string) => void;
  chooseChip: (chip: string) => void;
  confirmLearned: () => void;
  chooseDesign: (design: DesignCard) => void;
  stop: () => void;
  back: () => Promise<void>;
  /** An edit on the canvas. Resolves false (and says why) if it was refused. */
  edit: (target: "draft" | "learned", ops: PatchOp[]) => Promise<boolean>;
  publish: (access: PublishResult["access"], emails: string[]) => Promise<void>;
}

/**
 * Everything the onboarding session decides (chunk 20a), apart from how it looks: the draft and
 * its live events (`useBotDraftSession`), the chat as rows, which canvas sections a step shows,
 * and every action (send, stop, back, edit, publish). Screens only draw this and call it, so the
 * design pass can replace them without touching the logic.
 */
export const useOnboardingSession = (
  draftId: string,
  onError: (message: string) => void,
): OnboardingSession => {
  const session: BotDraftSession = useBotDraftSession(draftId);
  const { view, sending, working, send, setView } = session;
  const [published, setPublished] = useState<PublishResult | null>(null);
  const [patchDraft] = usePatchBotDraftMutation();
  const [goBack] = useBackBotDraftMutation();
  const [publishDraft, { isLoading: publishing }] = usePublishBotDraftMutation();
  const { data: page } = useGetBotPageQuery(view?.chatbotId ?? "", { skip: !view?.chatbotId });

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

  const rows = useMemo<ChatRow[]>(() => {
    const entries = (view?.transcript ?? []).filter(entry => entry.role !== "note");
    const lastBuilder = [...entries].reverse().find(e => e.role === "builder")?.id;
    return entries.map(entry => ({
      id: entry.id,
      from: entry.role === "owner" ? "owner" : "builder",
      text: entry.text,
      chips: entry.id === lastBuilder && !sending ? (entry.chips ?? []) : [],
    }));
  }, [view, sending]);

  const edit = useCallback(
    async (target: "draft" | "learned", ops: PatchOp[]) => {
      if (!view) return false;
      try {
        setView(await patchDraft({ id: view.id, target, ops, version: view.version }).unwrap());
        return true;
      } catch (err) {
        onError(errorText(err));
        void session.reload();
        return false;
      }
    },
    [onError, patchDraft, session, setView, view],
  );

  const step = view?.step ?? "start";
  const building = step === "building" || (sending && working === COPY.working.drafting);
  const sections: CanvasSection[] = view
    ? [
        ...(view.source.website ? (["reading"] as const) : []),
        ...(reached(step, "learned") ? (["learned"] as const) : []),
        ...(view.safety?.on ? (["safety"] as const) : []),
        ...(view.designs && reached(step, "design") ? (["designs"] as const) : []),
        ...(building || reached(step, "share") ? (["building"] as const) : []),
        ...(reached(step, "share") ? (["assistant", "share"] as const) : []),
      ]
    : [];
  const notes = (view?.transcript ?? []).filter(entry => entry.role === "note");

  return {
    view,
    reading: session.reading,
    rows,
    note: notes[notes.length - 1] ?? null,
    sending,
    working,
    streaming: session.streaming,
    error: session.error,
    questionsLeft: step === "gaps" ? (view?.conversation.questionsLeft ?? null) : null,
    sections,
    focusSection: STEP_SECTION[step] ?? null,
    building,
    canGoBack: reached(step, "safety") && step !== "published" && !sending,
    canChooseDesign: step === "design" && !sending,
    publicAllowed: Boolean(page?.publicAllowed),
    published,
    publishing,
    canvasVersion: session.canvasVersion,

    say: text => void send({ text }),
    chooseChip: chip => void send({ chip }),
    confirmLearned: () => void send({ chip: COPY.learned.confirm }),
    chooseDesign: design => void send({ chip: `design:${design.id}` }, design.title),
    stop: session.stop,
    back: async () => {
      if (!view) return;
      try {
        setView(await goBack(view.id).unwrap());
      } catch (err) {
        onError(errorText(err));
      }
    },
    edit,
    publish: async (access, emails) => {
      if (!view) return;
      try {
        setPublished(await publishDraft({ id: view.id, access, emails }).unwrap());
        void session.reload();
      } catch (err) {
        onError(errorText(err));
      }
    },
  };
};
