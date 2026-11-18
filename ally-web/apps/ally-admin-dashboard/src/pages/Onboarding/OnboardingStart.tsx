import React, { useRef, useState } from "react";

import { useNavigate } from "react-router-dom";

import { Button, PrimaryButton, Question, StepFrame } from "@components/v2";
import { ROUTES } from "@constants";

import { COPY, fill } from "./copy";
import { ACCEPTED_FILES, filesProblem } from "./useDraftUpload";
import { useOnboardingStart } from "./useOnboardingStart";

/** Before the read, the flow's length is a guess: the screenshots' typical twelve steps. */
const TYPICAL_STEPS = 12;

type StartMode = "choose" | "website" | "documents" | "describe" | "interview";

const METHODS: { id: Exclude<StartMode, "choose">; icon: string }[] = [
  { id: "website", icon: "🌐" },
  { id: "documents", icon: "📄" },
  { id: "describe", icon: "✏️" },
  { id: "interview", icon: "💬" },
];

const formStyle = { display: "flex", flexDirection: "column", gap: 14 } as const;

/**
 * Onboarding's start (copy §1), screen 1 of the one-screen flow (chunk 20d). It opens on four
 * ways to begin (website, documents, a description, an interview); picking one swaps in that
 * way's input, with Back to the choices and × to leave. Presentation only: what each way does is
 * `useOnboardingStart`.
 */
export const OnboardingStart: React.FC = () => {
  const navigate = useNavigate();
  const start = useOnboardingStart();
  const [mode, setMode] = useState<StartMode>("choose");
  const [website, setWebsite] = useState("");
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [fileProblem, setFileProblem] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const open = (id: string | null) => {
    if (id) navigate(ROUTES.CHATBOT_NEW_SESSION(id));
  };

  const leave = () => navigate(ROUTES.WHATSAPP_BOT);
  const choices = () => {
    setMode("choose");
    setFileProblem(null);
  };

  const pickFiles = (picked: File[]) => {
    const next = [...files, ...picked];
    const problem = filesProblem(next);
    setFileProblem(problem);
    if (!problem) setFiles(next);
  };

  return (
    <StepFrame
      screenKey={mode}
      labels={{
        saved: COPY.frame.saved,
        back: COPY.frame.back,
        close: COPY.frame.close,
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
      canGoBack={mode !== "choose"}
      onBack={choices}
      onLeave={leave}
      onClose={leave}
    >
      {mode === "choose" && (
        <>
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
            <ul className="ally-methods" aria-label={COPY.start.methodsLabel}>
              {METHODS.map(({ id, icon }) => (
                <li key={id}>
                  <button
                    type="button"
                    className="ally-method ally-press"
                    data-testid={`start-method-${id}`}
                    onClick={() => setMode(id)}
                  >
                    <span className="ally-method__icon" aria-hidden="true">
                      {icon}
                    </span>
                    <span className="ally-method__title">{COPY.start.methods[id].title}</span>
                    <span className="ally-method__hint">{COPY.start.methods[id].hint}</span>
                  </button>
                </li>
              ))}
            </ul>
          </Question>
        </>
      )}

      {mode === "website" && (
        <Question title={COPY.start.methods.website.title} subtitle={COPY.start.websiteSubtitle}>
          <form
            style={formStyle}
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
        </Question>
      )}

      {mode === "documents" && (
        <Question title={COPY.start.documentsTitle} subtitle={COPY.start.documentsSubtitle}>
          <div style={formStyle}>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept={ACCEPTED_FILES}
              hidden
              data-testid="onboarding-upload"
              onChange={event => {
                pickFiles(Array.from(event.target.files ?? []));
                event.target.value = "";
              }}
            />
            <Button variant="ghost" disabled={start.busy} onClick={() => fileRef.current?.click()}>
              {COPY.start.uploadButton}
            </Button>
            {files.length > 0 && (
              <ul className="ally-methods" style={{ gridTemplateColumns: "1fr", gap: 8 }}>
                {files.map((file, index) => (
                  <li key={`${file.name}-${index}`} className="ally-option">
                    <span className="ally-option__text">{file.name}</span>
                    <button
                      type="button"
                      className="ally-frame__close"
                      aria-label={fill(COPY.start.documentsRemove, { name: file.name })}
                      onClick={() => setFiles(files.filter((_, i) => i !== index))}
                    >
                      <span aria-hidden="true">×</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="ally-small" style={{ margin: 0 }}>
              {COPY.start.uploadLimits}
            </p>
            <PrimaryButton
              disabled={!files.length || start.busy}
              onClick={async () => open(await start.startWithFiles(files))}
            >
              {COPY.start.documentsStart}
            </PrimaryButton>
          </div>
        </Question>
      )}

      {mode === "describe" && (
        <Question title={COPY.start.methods.describe.title} subtitle={COPY.start.describePrompt}>
          <form
            style={formStyle}
            onSubmit={async event => {
              event.preventDefault();
              if (description.trim().length >= 20) {
                open(await start.startWithDescription(description));
              }
            }}
          >
            <textarea
              id="describe-business"
              aria-label={COPY.start.describePrompt}
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
        </Question>
      )}

      {mode === "interview" && (
        <Question title={COPY.start.interviewTitle} subtitle={COPY.start.interviewSubtitle}>
          <PrimaryButton
            disabled={start.busy}
            onClick={async () => open(await start.startWithInterview())}
          >
            {COPY.start.interviewButton}
          </PrimaryButton>
        </Question>
      )}

      {(start.error || fileProblem) && (
        <p className="ally-error" role="alert">
          {start.error ?? fileProblem}
        </p>
      )}

      <p className="ally-small" style={{ margin: 0 }}>
        {COPY.start.footnote}
      </p>
    </StepFrame>
  );
};
