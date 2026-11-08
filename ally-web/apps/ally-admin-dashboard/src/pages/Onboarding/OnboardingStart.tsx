import React, { useRef, useState } from "react";

import { useNavigate } from "react-router-dom";

import { Button, PrimaryButton, Question, StepFrame } from "@components/v2";
import { ROUTES } from "@constants";

import { COPY, fill } from "./copy";
import { ACCEPTED_FILES, useOnboardingStart } from "./useOnboardingStart";

/** Before the read, the flow's length is a guess: the screenshots' typical twelve steps. */
const TYPICAL_STEPS = 12;

/**
 * Onboarding's start (copy §1), screen 1 of the one-screen flow (chunk 20d). Presentation only:
 * what it does is `useOnboardingStart`.
 */
export const OnboardingStart: React.FC = () => {
  const navigate = useNavigate();
  const start = useOnboardingStart();
  const [mode, setMode] = useState<"website" | "describe">("website");
  const [website, setWebsite] = useState("");
  const [description, setDescription] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const open = (id: string | null) => {
    if (id) navigate(ROUTES.CHATBOT_NEW_SESSION(id));
  };

  return (
    <StepFrame
      screenKey={mode}
      labels={{
        saved: COPY.frame.saved,
        back: COPY.frame.back,
        step: fill(COPY.frame.step, {
          n: 1,
          total: TYPICAL_STEPS,
          "step name": COPY.frame.stepNames.start,
        }),
        progressSaved: COPY.frame.progressSaved,
        progressLabel: COPY.frame.progressLabel,
      }}
      breadcrumb={COPY.newAssistant}
      progress={0}
      saved={false}
      onLeave={() => navigate(ROUTES.WHATSAPP_BOT)}
    >
      {start.resume && (
        <button
          type="button"
          className="ally-option ally-press"
          onClick={() => open(start.resume!.id)}
        >
          <span className="ally-option__text">
            {fill(COPY.problems.resume, { business: start.resume.draft.name })}
          </span>
          <span aria-hidden="true">→</span>
        </button>
      )}

      <Question title={COPY.start.title} subtitle={COPY.start.subtitle}>
        {mode === "website" ? (
          <form
            style={{ display: "flex", flexDirection: "column", gap: 14 }}
            onSubmit={async event => {
              event.preventDefault();
              if (website.trim()) open(await start.startWithWebsite(website));
            }}
          >
            <input
              aria-label={COPY.start.placeholder}
              className="ally-input"
              placeholder={COPY.start.placeholder}
              value={website}
              onChange={event => setWebsite(event.target.value)}
              inputMode="url"
              autoFocus
            />
            <PrimaryButton
              type="submit"
              enterHint={COPY.frame.enterHint}
              disabled={!website.trim() || start.busy}
            >
              {COPY.start.primary}
            </PrimaryButton>
          </form>
        ) : (
          <form
            style={{ display: "flex", flexDirection: "column", gap: 14 }}
            onSubmit={async event => {
              event.preventDefault();
              if (description.trim().length >= 20) {
                open(await start.startWithDescription(description));
              }
            }}
          >
            <p className="ally-body" style={{ margin: 0 }}>
              {COPY.start.describePrompt}
            </p>
            <textarea
              id="describe-business"
              aria-label={COPY.start.describe}
              className="ally-input"
              rows={5}
              value={description}
              onChange={event => setDescription(event.target.value)}
              placeholder={COPY.start.describePlaceholder}
              autoFocus
            />
            <PrimaryButton type="submit" disabled={description.trim().length < 20 || start.busy}>
              {COPY.start.describeButton}
            </PrimaryButton>
          </form>
        )}
      </Question>

      {start.error && (
        <p className="ally-error" role="alert">
          {start.error}
        </p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start" }}>
        <Button variant="ghost" disabled={start.busy} onClick={() => fileRef.current?.click()}>
          {COPY.start.upload}
        </Button>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept={ACCEPTED_FILES}
          hidden
          data-testid="onboarding-upload"
          onChange={async event => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = "";
            open(await start.startWithFiles(files));
          }}
        />
        <Button
          variant="ghost"
          onClick={() => setMode(mode === "describe" ? "website" : "describe")}
        >
          {mode === "describe" ? COPY.start.primary : COPY.start.describe}
        </Button>
        <p className="ally-small" style={{ margin: 0 }}>
          {COPY.start.uploadLimits}
        </p>
      </div>

      <p className="ally-small" style={{ margin: 0 }}>
        {COPY.start.footnote}
      </p>
    </StepFrame>
  );
};
