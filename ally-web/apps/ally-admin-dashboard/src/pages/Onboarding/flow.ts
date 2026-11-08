import { COPY } from "./copy";
import { reached } from "./steps";

import type { BotDraftView, TranscriptEntry } from "./types";

/**
 * Onboarding one screen at a time (chunk 20d). Which screen to show is derived from the draft's
 * server step plus three things only the browser knows: whether the owner has moved past the
 * reading result, the safety screen and "Make it yours". Those are remembered per draft, so
 * Resume opens the last screen the owner was on. Pure: no React.
 */
export type OnboardingScreen =
  | "reading"
  | "learned"
  | "safety"
  | "question"
  | "design"
  | "building"
  | "make"
  | "share"
  | "live";

/** Screens the browser moves past on its own (the server's step doesn't change). */
export interface PassedScreens {
  reading: boolean;
  safety: boolean;
  /** The finished build, whose Continue leads to Make it yours. */
  built: boolean;
  make: boolean;
}

export const NOTHING_PASSED: PassedScreens = {
  reading: false,
  safety: false,
  built: false,
  make: false,
};

/**
 * The builder message that announced the safety pack: its first reply after the owner confirmed
 * "What we learned" (every pack's message, including "Facts only", whose text doesn't name it).
 */
export const safetyEntry = (view: BotDraftView): number => {
  const confirmed = view.transcript.findIndex(
    e => e.role === "owner" && e.text === COPY.learned.confirm,
  );
  if (confirmed < 0) return -1;
  return view.transcript.findIndex((e, i) => i > confirmed && e.role === "builder");
};

/** Owner answers since the safety message: how many questions have been answered. */
export const answeredSinceSafety = (view: BotDraftView): number => {
  const from = safetyEntry(view);
  if (from < 0) return 0;
  return view.transcript.slice(from + 1).filter(e => e.role === "owner").length;
};

export const screenFor = (
  view: BotDraftView,
  passed: PassedScreens,
  /** The builder is writing the assistant (it does so in the design turn, before the step moves). */
  drafting = false,
): OnboardingScreen => {
  const step = view.step;
  if (step === "published" || view.status === "published") return "live";
  if (step === "start" || step === "reading") return "reading";
  if (step === "learned") {
    // The reading result stays up (1.2 s, or until "See what I learned") once the read finishes.
    return view.source.website && !passed.reading ? "reading" : "learned";
  }
  if (step === "safety" || step === "gaps") {
    // The safety screen comes first, until the owner continues or has answered a question.
    if (!passed.safety && answeredSinceSafety(view) === 0 && view.safety?.on) return "safety";
    return "question";
  }
  if (step === "design") return drafting ? "building" : "design";
  if (step === "building") return "building";
  if (step === "checkup" || step === "try_it") return "make";
  // share: the finished build (until Continue), Make it yours (it edits the built assistant), then
  // who can use it.
  if (!passed.built) return "building";
  return passed.make ? "share" : "make";
};

/**
 * What a draft opened now has already been past: everything before its step (a draft opened at
 * "share" was built, so the reading result and safety screen are behind it), unless this browser
 * remembers more. An owner who `watched` the read or the build finish sees its result first.
 */
export const passedFromStep = (
  view: BotDraftView,
  stored: Partial<PassedScreens>,
  watched: { reading: boolean; building: boolean } = { reading: false, building: false },
): PassedScreens => ({
  reading: stored.reading ?? (!watched.reading && view.step !== "reading" && view.step !== "start"),
  safety: stored.safety ?? reached(view.step, "design"),
  built: stored.built ?? (!watched.building && reached(view.step, "share")),
  make: stored.make ?? false,
});

/** Step names for the footer (copy §15), in order. The checkup comes with 20a-2. */
const NAMES = COPY.frame.stepNames;

export interface StepPosition {
  number: number;
  total: number;
  name: string;
  /** 0–100, for the top bar. */
  progress: number;
}

/**
 * "Step {n} of {total} · {step name}". Each question is its own step, so the total grows with the
 * questions the builder has left (the screenshots' "Step 5 of 12 · A few questions").
 */
export const stepPosition = (screen: OnboardingScreen, view: BotDraftView): StepPosition => {
  const answered = answeredSinceSafety(view);
  const left = view.conversation.questionsLeft ?? 0;
  const questions = Math.max(1, answered + (screen === "question" ? Math.max(left, 1) : left));
  // Start, Reading, What we learned, Safety, the questions, Choose a design, Building, Make it
  // yours, Share.
  const total = 4 + questions + 4;
  const before = 4;
  const index: Record<OnboardingScreen, number> = {
    reading: 2,
    learned: 3,
    safety: 4,
    question: before + Math.min(answered + 1, questions),
    design: before + questions + 1,
    building: before + questions + 2,
    make: before + questions + 3,
    share: total,
    live: total,
  };
  const name: Record<OnboardingScreen, string> = {
    reading: NAMES.reading,
    learned: NAMES.learned,
    safety: NAMES.safety,
    question: NAMES.questions,
    design: NAMES.design,
    building: NAMES.building,
    make: NAMES.make,
    share: NAMES.share,
    live: NAMES.share,
  };
  const number = index[screen];
  return {
    number,
    total,
    name: name[screen],
    progress: screen === "live" ? 100 : Math.round(((number - 1) / total) * 100),
  };
};

/**
 * The builder's message as a question screen shows it: the sentence that asks (one with a "?", or
 * a gap's "…couldn't find…") as the question, what comes before it as the builder's line, and
 * what follows under it. "Done. I added those fees. One thing I couldn't find: your cancellation
 * policy. People often ask before they book." → line "Done. I added those fees.", question "One
 * thing I couldn't find: your cancellation policy.", subtitle "People often ask before they book."
 */
export const splitQuestion = (text: string): { lead: string; title: string; subtitle: string } => {
  const sentences =
    text
      .trim()
      .match(/[^.?!]+(?:[.?!]+|$)/g)
      ?.map(x => x.trim())
      .filter(Boolean) ?? [];
  if (!sentences.length) return { lead: "", title: "", subtitle: "" };
  let at = sentences.findIndex(x => x.includes("?"));
  if (at < 0) at = sentences.findIndex(x => /couldn['’]t find|could not find/i.test(x));
  if (at < 0) at = 0;
  if (sentences[at].length > 160) return { lead: "", title: text.trim(), subtitle: "" };
  return {
    lead: sentences.slice(0, at).join(" "),
    title: sentences[at],
    subtitle: sentences.slice(at + 1).join(" "),
  };
};

/** The language question takes several answers (copy §6): its chips are the deck's languages. */
export const isMultiSelect = (chips: string[]): boolean =>
  chips.length > 1 &&
  chips.every(chip => (COPY.gaps.languages as readonly string[]).includes(chip));

/**
 * Whether the question wants a typed answer: no quick replies, or only a gap's way out ("Skip for
 * now", "We don't offer this") after the owner chose "Add it now".
 */
export const wantsText = (chips: string[]): boolean =>
  chips.length === 0 ||
  (chips.every(chip => (COPY.gaps.chips as readonly string[]).includes(chip)) &&
    !chips.includes(COPY.gaps.chips[0]));

/** The builder's latest message, and its quick replies unless it is working. */
export const latestBuilder = (transcript: TranscriptEntry[]): TranscriptEntry | null => {
  for (let i = transcript.length - 1; i >= 0; i -= 1) {
    if (transcript[i].role === "builder") return transcript[i];
  }
  return null;
};

/** The emails typed into the invite box (commas, spaces or new lines between them). */
export const parseEmails = (text: string): string[] =>
  text
    .split(/[\s,;]+/)
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);
