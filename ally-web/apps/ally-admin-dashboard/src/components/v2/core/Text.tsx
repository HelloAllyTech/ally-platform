import React from "react";

import { Orb } from "./Orb";

/** The builder speaking on a screen (DESIGN.md §4): the orb and its line. Streams with a caret. */
export const AssistantLine: React.FC<{
  children: React.ReactNode;
  streaming?: boolean;
  working?: boolean;
}> = ({ children, streaming = false, working = false }) => (
  <div className="ally-assistant-line" aria-live="polite">
    <Orb size={24} working={working || streaming} />
    <p style={{ margin: 0 }}>
      {children}
      {streaming && <span className="ally-caret" aria-hidden="true" />}
    </p>
  </div>
);

/**
 * A screen's question (DESIGN.md §4): mono eyebrow, display-size question, optional subtitle,
 * then the answer control. The heading takes focus when the screen opens (`headingRef`).
 */
export const Question: React.FC<{
  eyebrow?: string;
  title: string;
  subtitle?: React.ReactNode;
  headingRef?: React.Ref<HTMLHeadingElement>;
  as?: "h1" | "h2";
  children?: React.ReactNode;
}> = ({ eyebrow, title, subtitle, headingRef, as: Heading = "h1", children }) => (
  <div className="ally-question">
    {eyebrow && <span className="ally-label">{eyebrow}</span>}
    <Heading ref={headingRef} tabIndex={-1} className="ally-display">
      {title}
    </Heading>
    {subtitle && <p className="ally-question__subtitle">{subtitle}</p>}
    {children}
  </div>
);

/** The thin progress bar (3 px; width eases over 600 ms). */
export const ProgressBar: React.FC<{ value: number; max?: number; label: string }> = ({
  value,
  max = 100,
  label,
}) => (
  <div
    className="ally-progress"
    role="progressbar"
    aria-label={label}
    aria-valuemin={0}
    aria-valuemax={max}
    aria-valuenow={Math.round(value)}
  >
    <div
      className="ally-progress__bar"
      style={{ width: `${Math.max(0, Math.min(100, (value / max) * 100))}%` }}
    />
  </div>
);
