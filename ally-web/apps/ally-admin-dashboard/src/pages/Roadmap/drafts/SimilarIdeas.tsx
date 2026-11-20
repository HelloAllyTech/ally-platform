import React, { useEffect, useState } from "react";

import { AnimatePresence, motion } from "framer-motion";
import { Link } from "react-router-dom";

import { Button, Tooltip } from "@ally-ui-mono/ui-shared";
import { TooltipIcon } from "@assets";
import { ROUTES, en } from "@constants";

import { useGetRoadmapDraftSimilarQuery } from "../../../api/roadmapV2Flow";
import { fadeUpVariants, motionTransition, useReducedMotionPreference } from "../../../motion";

/** Similar ideas look again once typing has stopped this long (contract: ≥ 1.5 s). */
export const SIMILAR_DEBOUNCE_MS = 1500;
/** Fewer characters than the server's floor isn't worth asking about. */
const SIMILAR_MIN_CHARS = 15;

interface SimilarIdeasProps {
  code?: string;
  text: string;
  readOnly: boolean;
  /** The words were saved: only then does the server's copy match what's on screen. */
  saved: boolean;
  onAddTo: (target: string) => Promise<void>;
}

/**
 * Similar ideas appear as you type, at most 2 (§4.2). Add my point to OPP-212 votes, posts your
 * text there as your comment and archives this draft, so your words aren't lost.
 */
export const SimilarIdeas: React.FC<SimilarIdeasProps> = ({
  code,
  text,
  readOnly,
  saved,
  onAddTo,
}) => {
  const reduced = useReducedMotionPreference();
  const copy = en.roadmapV2;
  const [settled, setSettled] = useState(text);
  useEffect(() => {
    const t = setTimeout(() => setSettled(text), SIMILAR_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [text]);
  const skip = !code || !saved || settled.trim().length < SIMILAR_MIN_CHARS;
  const { data } = useGetRoadmapDraftSimilarQuery({ code: code ?? "", text: settled }, { skip });
  const matches = (Array.isArray(data?.matches) ? data!.matches : []).slice(0, 2);
  const [adding, setAdding] = useState<string | null>(null);

  if (skip || matches.length === 0) return null;

  return (
    <section aria-label={copy.draft.similarTitle} className="flex flex-col gap-2">
      <div className="flex items-center gap-1">
        <h3 className="m-0 text-xs font-semibold uppercase tracking-wide text-typography-secondary">
          {copy.draft.similarTitle}
        </h3>
        <Tooltip label={copy.draft.addMyPointHelp} align="right">
          <button
            type="button"
            className="inline-flex cursor-pointer items-center"
            aria-label={copy.draft.addMyPointHelp}
          >
            <TooltipIcon />
          </button>
        </Tooltip>
      </div>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        <AnimatePresence initial={false}>
          {matches.map(match => (
            <motion.li
              key={match.code}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
              {...fadeUpVariants(reduced)}
              transition={motionTransition("moderate", "productive", reduced)}
            >
              <Link
                to={ROUTES.ROADMAP_IDEA(match.code)}
                className="text-primary-700 hover:underline"
              >
                {copy.draft.similarLine(match.code, match.title)}
              </Link>
              <span className="text-xs text-typography-secondary">
                {copy.status.votes(match.votes)} ·{" "}
                {copy.stages[match.shownStage] ?? match.shownStage}
              </span>
              {!readOnly && (
                <Button
                  kind="ghost"
                  size="sm"
                  disabled={!!adding}
                  onClick={async () => {
                    setAdding(match.code);
                    try {
                      await onAddTo(match.code);
                    } finally {
                      setAdding(null);
                    }
                  }}
                >
                  {copy.draft.addMyPoint(match.code)}
                </Button>
              )}
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </section>
  );
};
