import { FC } from "react";

import type { ItemGlyph } from "./itemTypes";

const PATHS: Record<ItemGlyph, string> = {
  // An open page.
  page: "M3 4.5C5 3.5 7 3.5 8 4.5c1-1 3-1 5 0v8c-2-1-4-1-5 0-1-1-3-1-5 0zM8 4.5v8",
  // A play triangle in a frame.
  play: "M2.5 3.5h11v9h-11zM6.5 6v4l3.5-2z",
  // A ticked box.
  check: "M2.5 2.5h11v11h-11zM5 8.2l2 2 4-4.4",
  // A pen nib.
  pen: "M8 2.5l3.5 5L8 13.5 4.5 7.5zM8 7.5v2.5",
  // A forking path.
  fork: "M8 13.5V9M8 9L4.5 5M8 9l3.5-4M4.5 5V2.5M11.5 5V2.5",
  // Two trays.
  trays: "M2.5 5.5h4.5v6h-4.5zM9 5.5h4.5v6H9zM2.5 4h11",
  // Two speech marks.
  speech: "M2.5 3.5h7v5h-4l-3 2.5zM11 6h2.5v5l-2-1.5H8.5V10",
  // A folder.
  folder: "M2.5 4.5h4l1.2 1.5h5.8v6.5h-11z",
  // A highlighter.
  highlighter: "M9.5 2.5l4 4-6 6h-4v-4zM2.5 13.5h11",
  // A four-point spark.
  spark:
    "M8 2.5c.6 3 2 4.4 5.5 5.5-3.5 1.1-4.9 2.5-5.5 5.5-.6-3-2-4.4-5.5-5.5C6 6.9 7.4 5.5 8 2.5z",
};

/** The type row's glyph. Always shown beside the type word, never alone (card grammar §1). */
export const CardGlyph: FC<{ glyph: ItemGlyph; className?: string }> = ({ glyph, className }) => (
  <svg
    viewBox="0 0 16 16"
    width="14"
    height="14"
    aria-hidden="true"
    className={className}
    fill="none"
    stroke="currentColor"
    strokeWidth="1.3"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d={PATHS[glyph]} />
  </svg>
);

/** The ✓ that draws on when an item is done. */
export const CheckGlyph: FC<{ className?: string }> = ({ className }) => (
  <svg
    viewBox="0 0 16 16"
    width="14"
    height="14"
    aria-hidden="true"
    className={`g-check ${className ?? ""}`}
  >
    <path
      d="M3.5 8.5l3 3 6-7"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const LockGlyph: FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" className={className}>
    <path
      d="M4.5 7.5h7v6h-7zM6 7.5V5.5a2 2 0 0 1 4 0v2"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
    />
  </svg>
);
