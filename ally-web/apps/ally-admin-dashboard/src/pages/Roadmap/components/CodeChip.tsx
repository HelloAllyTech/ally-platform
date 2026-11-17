import React, { useRef, useState } from "react";

import { AnimatePresence, motion } from "framer-motion";
import { Link } from "react-router-dom";

import { useGetRoadmapItemQuery } from "@api";
import { ROUTES, en } from "@constants";

import { motionTransition, popVariants, useReducedMotionPreference } from "../../../motion";
import { stageWord } from "../utils/copy";

/** An idea code written in prose: OPP-388. */
export const IDEA_CODE_RE = /\bOPP-\d+\b/g;

/** Split text into plain strings and idea codes, in order. */
export const splitCodes = (text: string): (string | { code: string })[] => {
  const out: (string | { code: string })[] = [];
  let last = 0;
  for (const match of text.matchAll(IDEA_CODE_RE)) {
    const index = match.index ?? 0;
    if (index > last) out.push(text.slice(last, index));
    out.push({ code: match[0] });
    last = index + match[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
};

const HOVER_DELAY_MS = 250;

/**
 * `OPP-388` anywhere in Roadmap becomes a chip (§4.11): a link to the idea, and on a pointer that
 * can hover, a preview with the title, stage and lead. Nothing depends on the hover — a tap or a
 * click simply opens the idea (§4.17).
 */
export const CodeChip: React.FC<{ code: string }> = ({ code }) => {
  const reduced = useReducedMotionPreference();
  const [hovered, setHovered] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { data } = useGetRoadmapItemQuery(code, { skip: !hovered });

  const enter = (event: React.PointerEvent) => {
    if (event.pointerType === "touch" || event.pointerType === "pen") return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setHovered(true), HOVER_DELAY_MS);
  };
  const leave = () => {
    if (timer.current) clearTimeout(timer.current);
    setHovered(false);
  };

  return (
    <span className="relative inline-block" onPointerEnter={enter} onPointerLeave={leave}>
      <Link
        to={ROUTES.ROADMAP_IDEA(code)}
        className="rounded border border-border-light bg-neutral-50 px-1 text-xs tabular-nums text-primary-700 no-underline hover:bg-primary-50"
        onFocus={() => setHovered(true)}
        onBlur={leave}
      >
        {code}
      </Link>
      <AnimatePresence>
        {hovered && data && (
          <motion.span
            role="tooltip"
            {...popVariants(reduced)}
            transition={motionTransition("fast", "productive", reduced)}
            className="absolute left-0 top-full z-50 mt-1 block w-64 rounded border border-border-light bg-white p-2 text-left text-xs shadow-lg"
          >
            <span className="block font-semibold text-typography-primary">{data.title}</span>
            <span className="block text-typography-secondary">
              {stageWord(data.shownStage)}
              {data.lead?.name ? ` · ${en.roadmapV2.people.leads(data.lead.name)}` : ""}
            </span>
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
};

/** Text with every idea code turned into a chip. */
export const CodeText: React.FC<{ text: string }> = ({ text }) => (
  <>
    {splitCodes(text).map((part, index) =>
      typeof part === "string" ? (
        <React.Fragment key={index}>{part}</React.Fragment>
      ) : (
        <CodeChip key={`${part.code}-${index}`} code={part.code} />
      ),
    )}
  </>
);
