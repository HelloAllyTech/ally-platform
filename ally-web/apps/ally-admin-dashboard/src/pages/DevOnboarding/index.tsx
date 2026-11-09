import React, { useEffect, useMemo, useState } from "react";

import { useSearchParams } from "react-router-dom";

import { baseView, QUESTIONS, READING_FINDINGS, SAFETY_LINE, say } from "./fixtures";
import { flowFor, PassedScreens } from "../Onboarding/flow";
import { OnboardingView } from "../Onboarding/OnboardingSession";

import type { BrandEditor } from "../../hooks/brand/useBrandEditor";
import type { BotDraftView, PublishResult } from "../Onboarding/types";
import type { OnboardingSession } from "../Onboarding/useOnboardingSession";

/** The flow's stages, in order. `?screen=` opens one; the harness's actions step to the next. */
const STAGES = [
  "reading",
  "reading-done",
  "learned",
  "safety",
  "question-1",
  "question-2",
  "question-3",
  "question-4",
  "design",
  "building",
  "building-done",
  "make",
  "share",
  "live",
] as const;
type Stage = (typeof STAGES)[number];

const PUBLISHED: PublishResult = {
  chatbotId: "dev-bot",
  slug: "sunrise-mind",
  link: "http://localhost:8081/b/sunrise-mind",
  access: "invite",
};

/** The draft as it stands at a stage, and what the browser has moved past. */
function stageState(stage: Stage): {
  view: BotDraftView;
  passed: PassedScreens;
  drafting: boolean;
} {
  const view = baseView();
  const index = STAGES.indexOf(stage);
  const passed: PassedScreens = {
    reading: index >= STAGES.indexOf("learned"),
    safety: index >= STAGES.indexOf("question-1"),
    built: index >= STAGES.indexOf("make"),
    make: index >= STAGES.indexOf("share"),
  };
  if (index >= STAGES.indexOf("reading-done")) {
    view.step = "learned";
    view.crawl = { ...view.crawl, status: "done", finishedAt: "2026-11-08T10:00:38.000Z" };
  }
  if (index >= STAGES.indexOf("safety")) {
    view.step = "gaps";
    view.transcript.push(
      say("o-confirm", "owner", "Looks right"),
      say("b-safety", "builder", SAFETY_LINE),
    );
    const answered = Math.max(0, index - STAGES.indexOf("question-1"));
    const asked = Math.min(answered, QUESTIONS.length - 1);
    for (let i = 0; i <= asked; i += 1) {
      if (i > 0) view.transcript.push(say(`o-${i}`, "owner", QUESTIONS[i - 1].chips[1]));
      view.transcript.push(say(`b-q${i}`, "builder", QUESTIONS[i].text, QUESTIONS[i].chips));
    }
    view.conversation = { ...view.conversation, questionsLeft: QUESTIONS.length - asked };
  }
  if (index >= STAGES.indexOf("design")) {
    view.step = "design";
    view.transcript.push(
      say("o-last", "owner", QUESTIONS[QUESTIONS.length - 1].chips[0]),
      say(
        "b-design",
        "builder",
        "Based on what I learned, here are a few ways your assistant could help. Pick one. You can change it later.",
      ),
    );
    view.conversation = { ...view.conversation, questionsLeft: null };
  }
  if (index >= STAGES.indexOf("building-done")) {
    view.step = "share";
    view.draft.design = "guide";
  }
  if (stage === "live") {
    view.step = "published";
    view.status = "published";
  }
  return { view, passed, drafting: stage === "building" };
}

const noop = () => undefined;

/** A brand editor that holds still: Make it yours' controls and preview, without the API. */
const staticEditor: BrandEditor = {
  brand: {
    logo: null,
    accent: "#C4512D",
    accentContrast: "#B5431F",
    headingStyle: "classic",
    theme: "light",
    coverImage: null,
    shareImage: null,
    landingImages: { hero: null, gallery: [] },
    peoplePhotos: {},
  },
  images: {},
  imageFor: () => null,
  uploading: {},
  errors: {},
  changed: false,
  saved: true,
  change: noop,
  upload: async () => undefined,
  remove: noop,
  uploadPerson: async () => undefined,
  personUploading: null,
  personError: null,
  undo: noop,
  dismissChanged: noop,
};

/**
 * Onboarding's screens from fixtures, for review and the browser tests (chunk 20d): the real
 * `OnboardingView`, fed by a scripted session whose every action moves to the next stage, so the
 * whole flow can be walked with the keyboard. Development builds only; nothing is sent anywhere.
 */
const DevOnboarding: React.FC = () => {
  const [params, setParams] = useSearchParams();
  const requested = params.get("screen") as Stage | null;
  const [stage, setStage] = useState<Stage>(
    requested && STAGES.includes(requested) ? requested : "reading",
  );
  const next = () => {
    const at = STAGES.indexOf(stage);
    const following = STAGES[Math.min(at + 1, STAGES.length - 1)];
    setStage(following);
    setParams({ screen: following }, { replace: true });
  };

  // The read and the build finish on their own, as they do for real.
  useEffect(() => {
    if (stage !== "reading" && stage !== "building") return undefined;
    if (params.get("hold") === "1") return undefined;
    const timer = setTimeout(next, 1500);
    return () => clearTimeout(timer);
  });

  const s = useMemo<OnboardingSession>(() => {
    const { view, passed, drafting } = stageState(stage);
    const advance = () => next();
    return {
      view,
      reading: {
        domain: view.crawl.domain,
        read: view.crawl.pagesRead,
        findings: READING_FINDINGS,
        done: stage === "reading" ? null : { n: 15, seconds: 38 },
        startedAt: null,
      },
      rows: [],
      note: null,
      sending: drafting,
      working: drafting ? "Writing your assistant" : null,
      streaming: "",
      error: null,
      questionsLeft: view.conversation.questionsLeft,
      sections: [],
      focusSection: null,
      building: drafting,
      canGoBack: false,
      canChooseDesign: view.step === "design",
      publicAllowed: false,
      published: stage === "live" ? PUBLISHED : null,
      publishing: false,
      canvasVersion: 0,
      say: advance,
      chooseChip: advance,
      confirmLearned: advance,
      chooseDesign: advance,
      stop: noop,
      back: async () => undefined,
      edit: async () => true,
      publish: async () => advance(),
      flow: flowFor(view, passed, { sending: drafting, drafting, streaming: "" }),
      pass: advance,
      backScreen: async () => undefined,
    };
    // `next` changes every render; the stage is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  return (
    <div style={{ height: "100vh" }}>
      <OnboardingView s={s} editor={staticEditor} onLeave={noop} onConnectWhatsApp={noop} />
    </div>
  );
};

export default DevOnboarding;
