import React from "react";

/**
 * Plain-language definitions for the terms analytics leans on without saying
 * what they mean. Used by the page's "Terms used here" panel and by `Jargon`.
 */
export const ANALYTICS_GLOSSARY: Array<{ term: string; meaning: string }> = [
  {
    term: "Role-slip",
    meaning:
      "A turn where the AI actor stops playing the client and starts sounding like a helper or an assistant. Rate = slips ÷ judged turns.",
  },
  {
    term: "Proxy NPS",
    meaning:
      "A net-promoter-style score (−100 to +100) derived from the 1–5 post-session rating, not from a real “would you recommend” question. Use it for direction, not as a benchmark against other products.",
  },
  {
    term: "Noise band",
    meaning:
      "How much a learner's score normally wobbles between two practice slices. A change smaller than the band is treated as no change, so it is not reported as improving or declining.",
  },
  {
    term: "Slice / cut",
    meaning: "One scored chunk of a learner's practice speech; the unit the skills judge scores.",
  },
  {
    term: "n = …",
    meaning:
      "How many observations stand behind a number. Small n means the number can swing a lot.",
  },
  {
    term: "AAQ-nnn",
    meaning:
      "A chart's stable id, for quoting it in a ticket. Hidden by default; tick “Show chart IDs” to display them.",
  },
];

/** A term with a dotted underline whose meaning shows on hover and to screen readers. */
export const Jargon: React.FC<{ term: string; children?: React.ReactNode }> = ({
  term,
  children,
}) => {
  const entry = ANALYTICS_GLOSSARY.find(g => g.term.toLowerCase() === term.toLowerCase());
  if (!entry) return <>{children ?? term}</>;
  return (
    <abbr
      title={entry.meaning}
      className="cursor-help underline decoration-dotted underline-offset-2"
      style={{ textDecorationLine: "underline" }}
    >
      {children ?? term}
    </abbr>
  );
};
