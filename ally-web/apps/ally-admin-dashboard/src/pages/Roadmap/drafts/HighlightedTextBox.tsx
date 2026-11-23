import React, { useEffect, useLayoutEffect, useRef } from "react";

import { motion } from "framer-motion";

import { useReducedMotionPreference } from "../../../motion";

/** Where `quote` sits in `text`, ignoring case and runs of whitespace. Null when it isn't there. */
export const findQuote = (text: string, quote: string): { start: number; end: number } | null => {
  const needle = quote
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.,;:!?…"'”’]+$/, "")
    .toLowerCase();
  if (!needle) return null;
  // Map the collapsed haystack back to original offsets.
  const map: number[] = [];
  let collapsed = "";
  let lastSpace = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const space = /\s/.test(ch);
    if (space && lastSpace) continue;
    collapsed += space ? " " : ch.toLowerCase();
    map.push(i);
    lastSpace = space;
  }
  const normalise = (s: string) => s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  const at = normalise(collapsed).indexOf(normalise(needle));
  if (at === -1) return null;
  const start = map[at];
  const end = map[at + needle.length - 1] + 1;
  return { start, end };
};

interface HighlightedTextBoxProps extends Omit<
  React.TextareaHTMLAttributes<HTMLTextAreaElement>,
  "onChange" | "value"
> {
  value: string;
  onChange: (value: string) => void;
  /** The quoted words to glow, and a token that changes each time they should glow again. */
  glow?: { quote: string; token: number } | null;
  textareaRef?: React.Ref<HTMLTextAreaElement>;
  /** Grows with its content between these heights. */
  minRows?: number;
}

/**
 * The idea box. A check that's met makes the words that met it glow in the box for a moment (a
 * highlight that fades over 1.2 s), linking cause and effect (§4.18 "A check is met"). A textarea
 * can't style a range, so a mirror of the text sits behind it, transparent except for the mark.
 * Under reduced motion the mark shows for the same 1.2 s with no fade.
 */
export const HighlightedTextBox: React.FC<HighlightedTextBoxProps> = ({
  value,
  onChange,
  glow,
  textareaRef,
  minRows = 3,
  className = "",
  ...rest
}) => {
  const reduced = useReducedMotionPreference();
  const mirrorRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLTextAreaElement | null>(null);
  const range = glow ? findQuote(value, glow.quote) : null;

  const setRefs = (node: HTMLTextAreaElement | null) => {
    innerRef.current = node;
    if (typeof textareaRef === "function") textareaRef(node);
    else if (textareaRef && typeof textareaRef === "object")
      (textareaRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = node;
  };

  // Grow with the text (no inner scrollbar to keep in sync on most drafts).
  useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  useEffect(() => {
    const el = innerRef.current;
    const mirror = mirrorRef.current;
    if (!el || !mirror) return undefined;
    const sync = () => {
      mirror.scrollTop = el.scrollTop;
    };
    el.addEventListener("scroll", sync);
    return () => el.removeEventListener("scroll", sync);
  }, []);

  const shared =
    "whitespace-pre-wrap break-words px-3 py-2 text-base leading-6 font-[inherit] tracking-normal";

  return (
    <div className="relative">
      <div
        ref={mirrorRef}
        className={`pointer-events-none absolute inset-0 overflow-hidden text-transparent ${shared}`}
        aria-hidden
      >
        {range ? (
          <>
            {value.slice(0, range.start)}
            <motion.mark
              key={glow?.token}
              className="rounded bg-warning-200 text-transparent"
              initial={{ opacity: 1 }}
              animate={{ opacity: reduced ? [1, 1, 0] : 0 }}
              transition={
                reduced
                  ? { duration: 1.2, times: [0, 0.99, 1], ease: "linear" }
                  : { duration: 1.2, ease: "easeOut" }
              }
              data-testid="roadmap-quote-glow"
            >
              {value.slice(range.start, range.end)}
            </motion.mark>
            {value.slice(range.end)}
          </>
        ) : (
          value
        )}
        {"\n"}
      </div>
      <textarea
        ref={setRefs}
        value={value}
        rows={minRows}
        onChange={event => onChange(event.target.value)}
        className={`relative block w-full resize-none bg-transparent outline-none ${shared} ${className}`}
        {...rest}
      />
    </div>
  );
};
