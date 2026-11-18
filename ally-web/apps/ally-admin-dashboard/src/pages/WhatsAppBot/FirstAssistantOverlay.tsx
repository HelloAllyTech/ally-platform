import React, { lazy, Suspense, useCallback, useEffect, useState } from "react";

import { createPortal } from "react-dom";

import { Button } from "@components/button";
import { ButtonVariant } from "@components/types";

import { COPY } from "../Onboarding/copy";

import "./first-assistant-overlay.css";

// The onboarding start screen is only needed here, and only for people with no assistant yet.
const OnboardingStart = lazy(() =>
  import("../Onboarding/OnboardingStart").then(m => ({ default: m.OnboardingStart })),
);

const CLOSE_LABEL = "Close";
const DISMISSED_KEY = "ally.firstAssistantOverlay.dismissed";

const wasDismissed = (): boolean => {
  try {
    return sessionStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
};

/**
 * Full-screen first-run layer on the Assistants page. It shows the real first step of building an
 * assistant (the one "New assistant" leads to), so someone with none yet starts building straight
 * away. Closing it, with the button, Escape or the frame's own Back/logo, returns to the page as it
 * was and keeps it closed for the rest of the session.
 */
export const FirstAssistantOverlay: React.FC = () => {
  const [open, setOpen] = useState(() => !wasDismissed());

  const close = useCallback(() => {
    try {
      sessionStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      /* storage blocked: it just reopens next visit */
    }
    setOpen(false);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  if (!open) return null;

  return createPortal(
    <div
      className="ally-first-assistant"
      role="dialog"
      aria-modal="true"
      aria-label={COPY.header}
      data-testid="first-assistant-overlay"
    >
      <Button
        variant={ButtonVariant.ICON}
        type="button"
        className="ally-first-assistant__close"
        aria-label={CLOSE_LABEL}
        onClick={close}
      >
        <span aria-hidden="true">×</span>
      </Button>
      <Suspense fallback={null}>
        <OnboardingStart onLeave={close} />
      </Suspense>
    </div>,
    document.body,
  );
};
