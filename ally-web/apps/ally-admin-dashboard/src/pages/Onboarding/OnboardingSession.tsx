import React from "react";

import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";

import { AssistantLine, Orb, StepFrame, TellMeSomethingElse } from "@components/v2";
import { ROUTES } from "@constants";

import { COPY } from "./copy";
import { MakeItYoursScreen } from "./MakeItYours";
import {
  BuildingScreen,
  DesignScreen,
  LearnedScreen,
  LiveScreen,
  QuestionScreen,
  ReadingScreen,
  SafetyScreen,
  ShareScreen,
} from "./Screens";
import { reached } from "./steps";
import { useOnboardingSession } from "./useOnboardingSession";
import { useBrandEditor } from "../../hooks/brand/useBrandEditor";

import type { OnboardingScreen } from "./flow";

/** Screens with cards side by side get the wider column (DESIGN.md §2 max widths). */
const WIDTH: Partial<Record<OnboardingScreen, "result" | "wide">> = {
  learned: "result",
  safety: "result",
  design: "wide",
  make: "wide",
  live: "result",
};

/**
 * Onboarding, one screen at a time (chunk 20d). Presentation only: every decision and action is
 * `useOnboardingSession`; this picks the screen it names and puts it in the StepFrame, with
 * "Tell me something else" under it.
 */
export const OnboardingSession: React.FC = () => {
  const { draftId = "" } = useParams<{ draftId: string }>();
  const navigate = useNavigate();
  const s = useOnboardingSession(draftId, message => toast.error(message));
  const view = s.view;
  const flow = s.flow;
  const editor = useBrandEditor(view?.chatbotId ?? null, COPY.look.errors.failed);

  if (!view || !flow) {
    return (
      <div className="ally-v2" style={{ height: "100%", display: "grid", placeItems: "center" }}>
        <Orb size={56} working />
      </div>
    );
  }

  const screen = flow.screen;
  const working = s.sending && screen !== "question" && screen !== "building";
  const builderLine = working ? (
    <AssistantLine working streaming={Boolean(s.streaming)}>
      {s.streaming || s.working || ""}
    </AssistantLine>
  ) : null;

  const body = (() => {
    switch (screen) {
      case "reading":
        return <ReadingScreen view={view} reading={s.reading} onDone={() => s.pass("reading")} />;
      case "learned":
        return (
          <LearnedScreen
            view={view}
            busy={s.sending}
            onPatch={s.edit}
            onConfirm={s.confirmLearned}
          />
        );
      case "safety":
        return <SafetyScreen view={view} line={flow.line} onContinue={() => s.pass("safety")} />;
      case "question":
        return (
          <QuestionScreen
            key={view.transcript.length}
            lead={flow.question.lead}
            title={flow.question.title}
            subtitle={flow.question.subtitle}
            eyebrow={flow.question.eyebrow}
            options={flow.options}
            multiSelect={flow.multiSelect}
            textAnswer={flow.textAnswer}
            busy={s.sending}
            working={s.working}
            streaming={s.streaming}
            onChoose={s.chooseChip}
            onSay={s.say}
          />
        );
      case "design":
        return (
          <DesignScreen
            designs={view.designs ?? []}
            chosen={view.draft.design}
            canChoose={s.canChooseDesign}
            line={working ? undefined : flow.line}
            onChoose={id => {
              const card = view.designs?.find(d => d.id === id);
              if (card) s.chooseDesign(card);
            }}
          />
        );
      case "building":
        return (
          <BuildingScreen done={reached(view.step, "share")} onContinue={() => s.pass("built")} />
        );
      case "make":
        return (
          <MakeItYoursScreen
            view={view}
            onPatch={s.edit}
            onContinue={() => s.pass("make")}
            editor={editor}
          />
        );
      case "share":
        return (
          <ShareScreen
            view={view}
            publicAllowed={s.publicAllowed}
            publishing={s.publishing}
            onPublish={(access, emails) => void s.publish(access, emails)}
          />
        );
      case "live":
        return s.published ? (
          <LiveScreen
            view={view}
            published={s.published}
            onConnectWhatsApp={() =>
              navigate(`${ROUTES.CHATBOT_DETAIL.replace(":botId", view.chatbotId!)}?tab=connectors`)
            }
          />
        ) : (
          <Orb size={56} working />
        );
      default:
        return null;
    }
  })();

  return (
    <StepFrame
      screenKey={screen === "question" ? `question-${view.transcript.length}` : screen}
      labels={{
        saved: COPY.frame.saved,
        back: COPY.frame.back,
        step: flow.stepLabel,
        progressSaved: COPY.frame.progressSaved,
        progressLabel: COPY.frame.progressLabel,
      }}
      breadcrumb={view.draft.name || COPY.newAssistant}
      progress={flow.step.progress}
      width={WIDTH[screen] ?? "question"}
      canGoBack={flow.canBack}
      onBack={() => void s.backScreen()}
      onLeave={() => navigate(ROUTES.WHATSAPP_BOT)}
      below={
        <>
          {builderLine}
          {s.error && (
            <p className="ally-error" role="alert">
              {s.error}
            </p>
          )}
          {s.note && <p className="ally-small">{s.note.text}</p>}
          {screen !== "live" && (
            <TellMeSomethingElse
              labels={{
                collapsed: COPY.frame.tellCollapsed,
                placeholder: COPY.frame.tellPlaceholder,
                send: COPY.frame.send,
                stop: COPY.frame.stop,
              }}
              busy={s.sending}
              disabled={view.status !== "active"}
              onSend={s.say}
              onStop={s.stop}
            />
          )}
        </>
      }
    >
      {body}
    </StepFrame>
  );
};
