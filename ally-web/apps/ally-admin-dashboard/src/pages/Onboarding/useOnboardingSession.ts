import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  useArchiveChatbotMutation,
  useApplyDraftTemplateMutation,
  useBackBotDraftMutation,
  useDescribeBotDraftMutation,
  useCorrectBotDraftPackMutation,
  useGetBotPageQuery,
  useLazyGetCheckupRunQuery,
  usePatchBotDraftMutation,
  usePublishBotDraftMutation,
} from "@api";
import type { TemplateAnswers, TemplateInstallResult } from "@types";

import { COPY } from "./copy";
import {
  OnboardingScreenState,
  PassedScreens,
  answeredSinceSafety,
  flowFor,
  passedFromStep,
} from "./flow";
import { reached } from "./steps";
import { BotDraftSession, ReadingProgress, useBotDraftSession } from "./useBotDraftSession";
import { filesProblem, useDraftUpload } from "./useDraftUpload";
import { errorText } from "./useOnboardingStart";

import type {
  BotDraftStep,
  BotDraftView,
  DesignCard,
  PatchOp,
  PublishResult,
  TranscriptEntry,
} from "./types";

/** The canvas sections, in order. */
type CanvasSection =
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
interface ChatRow {
  id: string;
  from: "builder" | "owner";
  text: string;
  /** Quick replies: only on the latest builder message, and not while it's working. */
  chips: string[];
}

/** How long the reading result stays up before "What we learned" (chunk-20d §2). */
const READING_PAUSE_MS = 1200;

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
  publish: (
    access: PublishResult["access"],
    emails: string[],
    confirmMustPass?: boolean,
    publishAnyway?: boolean,
    recheckSafety?: boolean,
  ) => Promise<void>;
  /**
   * Publishing's safety recheck (Q4 A0): `checking` while the failed safety questions are asked
   * again (the page polls the run and publishes when it ends), `failed` with each question and
   * its answer when one still fails.
   */
  safety: {
    status: "checking" | "failed";
    message: string;
    done: number;
    total: number;
    questions: { question: string; reply?: string; reasons?: string[] }[];
  } | null;
  /** "Check again" after a failed safety recheck. */
  checkSafetyAgain: () => void;
  /** "This isn't right for my business" (Q4 A3): rejects when refused (a reason is needed). */
  choosePack: (pack: string, reason?: string) => Promise<void>;
  choosingPack: boolean;
  /**
   * Asked before going live: an owner's own Must pass question failed (chunk 20d-2), or the
   * checkup is below the quality gate (Q3-fast Part 3, `belowGate`).
   */
  mustPass: {
    message: string;
    questions: string[];
    access: PublishResult["access"];
    emails: string[];
    belowGate?: boolean;
    /** Whether Must pass was already confirmed on the way here. */
    confirmedMustPass?: boolean;
  } | null;

  /** The one-screen flow (chunk 20d). Null while the draft loads. */
  flow: OnboardingScreenState | null;
  /** Move past the reading result, the safety screen or "Make it yours". */
  /** Marks a browser-only screen done, or not done (`false`) to go back to it (Q4 H3). */
  pass: (screen: keyof PassedScreens, done?: boolean) => void;
  /** Back from the current screen: a browser-only screen, else the server's step back. */
  backScreen: () => Promise<void>;
  /** "Start from a template" after the site was read (T1): what it did, or null if refused. */
  applyTemplate: (
    template: string,
    answers: TemplateAnswers,
  ) => Promise<TemplateInstallResult | null>;
  /**
   * When the website gave nothing (chunk 20a-2): read a description or documents into "What we
   * learned" instead. Each resolves false, having said why, if it was refused.
   */
  describe: (text: string) => Promise<boolean>;
  upload: (files: File[]) => Promise<boolean>;
  /** Remove this unfinished assistant, to start again with another website. */
  discard: () => Promise<boolean>;
}

/** How often the page asks how publishing's safety recheck is going (Q4 A0). */
const RECHECK_POLL_MS = 3000;

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
  const [mustPass, setMustPass] = useState<OnboardingSession["mustPass"]>(null);
  const [safety, setSafety] = useState<OnboardingSession["safety"]>(null);
  const [recheckRunId, setRecheckRunId] = useState<string | null>(null);
  const lastPublish = useRef<{
    access: PublishResult["access"];
    emails: string[];
    confirmMustPass: boolean;
    publishAnyway: boolean;
  } | null>(null);
  const [pollRun] = useLazyGetCheckupRunQuery();
  const [correctPack, { isLoading: choosingPack }] = useCorrectBotDraftPackMutation();
  const [patchDraft] = usePatchBotDraftMutation();
  const [goBack] = useBackBotDraftMutation();
  const [applyDraftTemplate] = useApplyDraftTemplateMutation();
  const [publishDraft, { isLoading: publishing }] = usePublishBotDraftMutation();
  const [describeDraft] = useDescribeBotDraftMutation();
  const [archiveChatbot] = useArchiveChatbotMutation();
  const uploadToDraft = useDraftUpload();
  /** Runs an action, saying why it failed: false when it did. */
  const attempt = useCallback(
    async (action: () => Promise<unknown>) => {
      try {
        await action();
        return true;
      } catch (err) {
        onError(errorText(err));
        return false;
      }
    },
    [onError],
  );
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

  const flow = useMemo<OnboardingScreenState | null>(
    () =>
      view
        ? flowFor(view, passedFromStep(view, stored, watched), {
            sending,
            drafting,
            streaming: session.streaming,
          })
        : null,
    [view, stored, watched, sending, drafting, session.streaming],
  );

  const publish: OnboardingSession["publish"] = async (
    access,
    emails,
    confirmMustPass = false,
    publishAnyway = false,
    recheckSafety = false,
  ) => {
    if (!view) return;
    lastPublish.current = { access, emails, confirmMustPass, publishAnyway };
    try {
      setPublished(
        await publishDraft({
          id: view.id,
          access,
          emails,
          ...(confirmMustPass ? { confirmMustPass: true } : {}),
          ...(publishAnyway ? { publishAnyway: true } : {}),
          ...(recheckSafety ? { recheckSafety: true } : {}),
        }).unwrap(),
      );
      setMustPass(null);
      setSafety(null);
      setRecheckRunId(null);
      void session.reload();
    } catch (err) {
      // An owner's own Must pass question failed (chunk 20d-2): ask, then go live if they say so.
      const data = (err as { data?: { errorCode?: string; message?: string; details?: unknown } })
        ?.data;
      if (data?.errorCode === "must_pass_failed") {
        const details = data.details as { questions?: { question: string }[] } | undefined;
        setMustPass({
          message: data.message ?? "",
          questions: (details?.questions ?? []).map(q => q.question),
          access,
          emails,
        });
        return;
      }
      // Q4 A0: the failed safety questions are being asked again; poll, then publish again.
      if (data?.errorCode === "safety_recheck" || data?.errorCode === "safety_failed") {
        const details = (data.details ?? {}) as {
          recheckRunId?: string;
          done?: number;
          total?: number;
          questions?: { question: string; reply?: string }[];
        };
        const checking = data.errorCode === "safety_recheck";
        setSafety({
          status: checking ? "checking" : "failed",
          message: data.message ?? "",
          done: details.done ?? 0,
          total: details.total ?? details.questions?.length ?? 0,
          questions: details.questions ?? [],
        });
        setRecheckRunId(checking ? (details.recheckRunId ?? null) : null);
        return;
      }
      setSafety(null);
      setRecheckRunId(null);
      // Below the checkup's quality gate (Q3-fast Part 3): the score, then Publish anyway.
      if (data?.errorCode === "checkup_below_gate") {
        setMustPass({
          message: data.message ?? "",
          questions: [],
          access,
          emails,
          belowGate: true,
          confirmedMustPass: confirmMustPass,
        });
        return;
      }
      onError(errorText(err));
    }
  };

  /** "Check again" after a failed safety recheck (Q4 A0). */
  const checkSafetyAgain = () => {
    const last = lastPublish.current;
    if (last)
      void publish(last.access, last.emails, last.confirmMustPass, last.publishAnyway, true);
  };

  // Q4 A0: while the safety recheck runs, poll its run; when it ends, publish again with the
  // same choices, which goes on to the 70% gate or says which question still fails.
  useEffect(() => {
    if (!recheckRunId || !view?.chatbotId) return undefined;
    const chatbotId = view.chatbotId;
    let stopped = false;
    const timer = setInterval(async () => {
      const run = await pollRun({ id: chatbotId, runId: recheckRunId })
        .unwrap()
        .catch(() => null);
      if (stopped || !run) return;
      if (run.run.status === "running") {
        setSafety(current => current && { ...current, done: run.run.done, total: run.run.total });
        return;
      }
      stopped = true;
      clearInterval(timer);
      setRecheckRunId(null);
      const last = lastPublish.current;
      if (last) void publish(last.access, last.emails, last.confirmMustPass, last.publishAnyway);
    }, RECHECK_POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- publish reads the latest view
  }, [recheckRunId, view?.chatbotId]);

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
    mustPass,
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
    pass: (screen, done = true) => pass(screen, done),
    applyTemplate: async (template, answers) => {
      if (!view) return null;
      try {
        const { result, draft } = await applyDraftTemplate({
          draftId: view.id,
          template,
          answers,
        }).unwrap();
        setView(draft);
        return result;
      } catch (err) {
        onError(errorText(err));
        return null;
      }
    },
    backScreen: async () => {
      if (!view || !flow) return;
      // Browser-only screens step back without asking the server.
      if (flow.screen === "share") return pass("checkup", false);
      if (flow.screen === "checkup") return pass("make", false);
      if (flow.screen === "question" && answeredSinceSafety(view) === 0 && view.safety?.on) {
        return pass("safety", false);
      }
      try {
        setView(await goBack(view.id).unwrap());
      } catch (err) {
        onError(errorText(err));
      }
    },
    describe: text =>
      view
        ? attempt(() => describeDraft({ id: view.id, description: text.trim() }).unwrap())
        : Promise.resolve(false),
    upload: files => {
      const problem = filesProblem(files);
      if (problem) onError(problem);
      if (problem || !view?.chatbotId) return Promise.resolve(false);
      const chatbotId = view.chatbotId;
      return attempt(() => uploadToDraft({ id: view.id, chatbotId }, files));
    },
    discard: () =>
      view?.chatbotId
        ? attempt(() => archiveChatbot(view.chatbotId!).unwrap())
        : Promise.resolve(false),
    safety,
    checkSafetyAgain,
    choosePack: async (pack: string, reason?: string) => {
      if (!view) return;
      const next = await correctPack({ id: view.id, pack, ...(reason ? { reason } : {}) }).unwrap();
      setView(next);
    },
    choosingPack,
    publish,
  };
};
