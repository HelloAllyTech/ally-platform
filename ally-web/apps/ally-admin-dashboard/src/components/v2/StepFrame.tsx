import React, { useEffect, useRef } from "react";

import { Button, ProgressBar } from "./core";

export interface StepFrameLabels {
  saved: string;
  back: string;
  /** "Step {n} of {total} · {step name}", filled. */
  step: string;
  /** "Your progress is saved. You can come back any time." */
  progressSaved: string;
  progressLabel: string;
}

/** Widths from DESIGN.md §2: one question 640, results 760–920, design cards 1080. */
const WIDTHS = { question: 640, result: 840, wide: 1080 } as const;

/**
 * The onboarding frame (DESIGN.md §4): top bar (logo, breadcrumb, Back, "Saved"), a 3 px progress
 * bar, the centred screen, and the footer. When `screenKey` changes, the new screen rises in and
 * its heading takes focus, so keyboard and screen reader users land on the new question.
 */
export const StepFrame: React.FC<{
  screenKey: string;
  labels: StepFrameLabels;
  breadcrumb?: string;
  progress: number;
  width?: keyof typeof WIDTHS;
  canGoBack?: boolean;
  onBack?: () => void;
  onLeave?: () => void;
  saved?: boolean;
  /** "Tell me something else", under the screen. */
  below?: React.ReactNode;
  children: React.ReactNode;
}> = ({
  screenKey,
  labels,
  breadcrumb,
  progress,
  width = "question",
  canGoBack = false,
  onBack,
  onLeave,
  saved = true,
  below,
  children,
}) => {
  const screen = useRef<HTMLDivElement>(null);
  const first = useRef(true);

  useEffect(() => {
    const target = screen.current?.querySelector<HTMLElement>("h1, h2");
    if (!target) return;
    if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
    // On the first screen, leave focus where the page put it (an autofocused input, say).
    if (first.current) {
      first.current = false;
      if (document.activeElement && document.activeElement !== document.body) return;
    }
    target.focus({ preventScroll: true });
    screen.current?.closest(".ally-frame")?.scrollTo({ top: 0 });
  }, [screenKey]);

  return (
    <div className="ally-v2 ally-frame">
      <div className="ally-frame__top">
        <div className="ally-frame__bar">
          <div className="ally-frame__brand">
            <a
              className="ally-frame__logo"
              href="/chatbots"
              onClick={event => {
                if (!onLeave) return;
                event.preventDefault();
                onLeave();
              }}
            >
              <span className="ally-frame__tile" aria-hidden="true">
                A
              </span>
              Ally
            </a>
            {breadcrumb && <span className="ally-frame__crumb">/ {breadcrumb}</span>}
          </div>
          <div className="ally-frame__right">
            {canGoBack && onBack && (
              <Button variant="ghost" onClick={onBack}>
                <span aria-hidden="true">‹</span> {labels.back}
              </Button>
            )}
            {saved && <span className="ally-saved">{labels.saved}</span>}
          </div>
        </div>
        <ProgressBar value={progress} label={labels.progressLabel} />
      </div>
      <main className="ally-frame__main">
        <div
          key={screenKey}
          ref={screen}
          className="ally-frame__screen ally-rise"
          style={{ maxWidth: WIDTHS[width] }}
          data-testid={`screen-${screenKey}`}
        >
          {children}
          {below}
        </div>
      </main>
      <footer className="ally-frame__foot">
        <span aria-live="polite">{labels.step}</span>
        <span>{labels.progressSaved}</span>
      </footer>
    </div>
  );
};
