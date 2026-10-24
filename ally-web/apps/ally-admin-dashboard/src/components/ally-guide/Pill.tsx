import React from "react";

export type PillTone = "neutral" | "info" | "success" | "warning" | "danger";

const TONE_CLASSES: Record<PillTone, string> = {
  neutral: "bg-neutral-100 text-neutral-600",
  info: "bg-primary-50 text-primary-700",
  success: "bg-success-50 text-success-600",
  warning: "bg-warning-50 text-warning-text",
  danger: "bg-destructive-50 text-destructive-600",
};

interface PillProps {
  tone?: PillTone;
  children: React.ReactNode;
  title?: string;
  className?: string;
}

/**
 * A status pill. A styled span rather than Carbon's `<Tag>`: Tag renders a `<button>`, and these sit
 * inside clickable table rows, where a button in a button is invalid DOM and steals the click.
 * Meaning is always carried by the words, never by the colour alone.
 */
export const Pill: React.FC<PillProps> = ({ tone = "neutral", children, title, className }) => (
  <span
    title={title}
    className={[
      "inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium",
      TONE_CLASSES[tone],
      className ?? "",
    ].join(" ")}
  >
    {children}
  </span>
);
