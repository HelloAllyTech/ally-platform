import React, { useRef, useState } from "react";

import { useNavigate } from "react-router-dom";

import { AutoExpandableTextarea, InlineNotification } from "@ally-ui-mono/ui-shared";
import { Button } from "@components";
import { ButtonVariant } from "@components/types";
import { ROUTES } from "@constants";

import { COPY, fill } from "./copy";
import { ACCEPTED_FILES, useOnboardingStart } from "./useOnboardingStart";

/**
 * Onboarding's start (copy §1). Presentation only: what it does is `useOnboardingStart`, so a
 * restyle replaces this file and keeps the hook.
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
    <div className="flex h-full justify-center overflow-y-auto px-4 py-12">
      <div className="flex w-full max-w-xl flex-col gap-6">
        {start.resume && (
          <button
            type="button"
            onClick={() => open(start.resume!.id)}
            className="rounded-md border border-primary-200 bg-primary-50 px-4 py-3 text-left text-sm text-typography-900 hover:bg-primary-100"
          >
            {fill(COPY.problems.resume, { business: start.resume.draft.name })}
          </button>
        )}

        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-secondary text-typography-900">{COPY.start.title}</h1>
          <p className="text-base text-typography-700">{COPY.start.subtitle}</p>
        </div>

        {mode === "website" ? (
          <form
            className="flex flex-col gap-3 sm:flex-row"
            onSubmit={async event => {
              event.preventDefault();
              if (website.trim()) open(await start.startWithWebsite(website));
            }}
          >
            <input
              aria-label={COPY.start.placeholder}
              className="flex-1 rounded-md border border-border-light px-3 py-2 text-base focus:border-primary-600 focus:outline-none"
              placeholder={COPY.start.placeholder}
              value={website}
              onChange={event => setWebsite(event.target.value)}
              inputMode="url"
              autoFocus
            />
            <Button
              type="submit"
              variant={ButtonVariant.PRIMARY}
              disabled={!website.trim() || start.busy}
            >
              {COPY.start.primary}
            </Button>
          </form>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-typography-700">{COPY.start.describePrompt}</p>
            <AutoExpandableTextarea
              id="describe-business"
              value={description}
              onChange={setDescription}
              placeholder={COPY.start.describePlaceholder}
              maxLines={10}
            />
            <Button
              variant={ButtonVariant.PRIMARY}
              className="self-start"
              disabled={description.trim().length < 20 || start.busy}
              onClick={async () => open(await start.startWithDescription(description))}
            >
              {COPY.start.describeButton}
            </Button>
          </div>
        )}

        {start.error && (
          <InlineNotification kind="error" lowContrast hideCloseButton title={start.error} />
        )}

        <div className="flex flex-col gap-2 text-sm">
          <button
            type="button"
            className="self-start underline text-typography-800 disabled:opacity-50"
            disabled={start.busy}
            onClick={() => fileRef.current?.click()}
          >
            {COPY.start.upload}
          </button>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept={ACCEPTED_FILES}
            className="hidden"
            data-testid="onboarding-upload"
            onChange={async event => {
              const files = Array.from(event.target.files ?? []);
              event.target.value = "";
              open(await start.startWithFiles(files));
            }}
          />
          <button
            type="button"
            className="self-start underline text-typography-800"
            onClick={() => setMode(mode === "describe" ? "website" : "describe")}
          >
            {mode === "describe" ? COPY.start.primary : COPY.start.describe}
          </button>
          <p className="text-xs text-typography-600">{COPY.start.uploadLimits}</p>
        </div>

        <p className="text-xs text-typography-500">{COPY.start.footnote}</p>
      </div>
    </div>
  );
};
