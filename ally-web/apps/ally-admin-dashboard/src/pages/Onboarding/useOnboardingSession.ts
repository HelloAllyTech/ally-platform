import { useCallback, useEffect, useMemo, useState } from "react";

import {
  useBackBotDraftMutation,
  useGetBotPageQuery,
  usePatchBotDraftMutation,
  usePublishBotDraftMutation,
} from "@api";

import { COPY, fill } from "./copy";
import {
  OnboardingScreen,
  PassedScreens,
  StepPosition,
  answeredSinceSafety,
  isMultiSelect,
  safetyEntry,
  latestBuilder,
  wantsText,
  passedFromStep,
  screenFor,
  splitQuestion,
  stepPosition,
} from "./flow";
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

/** How long the reading result stays up before "What we learned" (chunk-20d §2). */
export const READING_PAUSE_MS = 1200;

const passedKey = (draftId: string) => `ally.onboarding.${draftId}.passed`;
const readPassed = (draftId: string): Partial<PassedScreens> => {
  try {
    return JSON.parse(window.localStorage.getItem(passedKey(draftId)) ?? "{}");
  } catch {
    return {};
  }
};
const writePassed = (draftId: string, passed: Partial<PassedScreens>) => {
  try {
    window.localStorage.setItem(passedKey(draftId), JSON.stringify(passed));
  } catch {
    // Private mode or storage off: the flow still works, it just won't remember on reload.
  }
};

/** What the one-screen flow shows now (chunk 20d), derived from the draft. */
export interface OnboardingScreenState {
  screen: OnboardingScreen;
  step: StepPosition;
  /** The footer's "Step {n} of {total} · {step name}". */
  stepLabel: string;
  /** The builder's line for this screen: streaming while it works, else its latest message. */
  line: string;
  /** A question screen's question and the text under it. */
  question: { lead: string; title: string; subtitle: string; eyebrow: string | null };
  /** Quick replies for this screen (none while the builder works). */
  options: string[];
  /** The language question takes several answers and an OK. */
  multiSelect: boolean;
  /** The question wants a typed answer (with OK), beside any quick replies. */
  textAnswer: boolean;
  /** Back can go somewhere from this screen. */
  canBack: boolean;
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

  /** The one-screen flow (chunk 20d). Null while the draft loads. */
  flow: OnboardingScreenState | null;
  /** Move past the reading result, the safety screen or "Make it yours". */
  pass: (screen: keyof PassedScreens) => void;
  /** Back from the current screen: a browser-only screen, else the server's step back. */
  backScreen: () => Promise<void>;
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
  const [publishedNow, setPublished] = useState<PublishResult | null>(null);
  const [patchDraft] = usePatchBotDraftMutation();
  const [goBack] = useBackBotDraftMutation();
  const [publishDraft, { isLoading: publishing }] = usePublishBotDraftMutation();
  const { data: page } = useGetBotPageQuery(view?.chatbotId ?? "", { skip: !view?.chatbotId });
  const [stored, setStored] = useState<Partial<PassedScreens>>(() => readPassed(draftId));
  const pass = useCallback(
    (screen: keyof PassedScreens, value = true) =>
      setStored(previous => {
        const next = { ...previous, [screen]: value };
        writePassed(draftId, next);
        return next;
      }),
    [draftId],
  );

  // An owner who watches the read finish sees its result for 1.2 s before "What we learned"; one
  // who watches the build sees it finish, then continues to Make it yours. Noted while rendering
  // (React's "adjust state when a prop changes"), so nothing is set from an effect.
  const step0 = view?.step;
  const [watched, setWatched] = useState({ reading: false, building: false });
  if ((step0 === "reading" || step0 === "start") && !watched.reading) {
    setWatched(w => ({ ...w, reading: true }));
  }
  const drafting = sending && working === COPY.working.drafting;
  if ((step0 === "building" || drafting) && !watched.building) {
    setWatched(w => ({ ...w, building: true }));
  }
  useEffect(() => {
    if (step0 !== "learned" || !watched.reading || stored.reading !== undefined) return undefined;
    const timer = setTimeout(() => pass("reading"), READING_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [step0, watched.reading, stored.reading, pass]);

  // A published draft opened again shows its live link.
  const published: PublishResult | null =
    publishedNow ??
    (view?.status === "published" && page?.link && view.chatbotId
      ? {
          chatbotId: view.chatbotId,
          slug: page.slug,
          link: page.link,
          access: page.access as PublishResult["access"],
        }
      : null);

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

  const flow = useMemo<OnboardingScreenState | null>(() => {
    if (!view) return null;
    const passed = passedFromStep(view, stored, watched);
    const screen = screenFor(view, passed, drafting);
    const position = stepPosition(screen, view);
    const latest = latestBuilder(view.transcript);
    const options = latest && !sending ? (latest.chips ?? []) : [];
    const left = view.conversation.questionsLeft;
    const safetyAt = safetyEntry(view);
    const line = sending
      ? session.streaming
      : screen === "safety" && safetyAt >= 0
        ? view.transcript[safetyAt].text
        : (latest?.text ?? "");
    return {
      screen,
      step: position,
      stepLabel: fill(COPY.frame.step, {
        n: position.number,
        total: position.total,
        "step name": position.name,
      }),
      line,
      question: {
        ...splitQuestion(latest?.text ?? ""),
        eyebrow:
          screen === "question" && left
            ? left === 1
              ? COPY.gaps.leftOne
              : fill(COPY.gaps.left, { n: left })
            : null,
      },
      options,
      multiSelect: isMultiSelect(options),
      textAnswer: !sending && wantsText(options),
      canBack:
        !sending &&
        (screen === "share" ||
          (screen === "question" && answeredSinceSafety(view) === 0) ||
          (reached(step, "safety") && step !== "published" && screen !== "live")),
    };
  }, [view, stored, watched, sending, drafting, session.streaming, step]);

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
    flow,
    pass: screen => pass(screen),
    backScreen: async () => {
      if (!view || !flow) return;
      // Browser-only screens step back without asking the server.
      if (flow.screen === "share") return pass("make", false);
      if (flow.screen === "question" && answeredSinceSafety(view) === 0 && view.safety?.on) {
        return pass("safety", false);
      }
      try {
        setView(await goBack(view.id).unwrap());
      } catch (err) {
        onError(errorText(err));
      }
    },
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
