import React, { useEffect, useRef, useState } from "react";

import { AnimatePresence, motion } from "framer-motion";

import { Button, Tooltip } from "@ally-ui-mono/ui-shared";
import { TooltipIcon } from "@assets";
import { en } from "@constants";

import { motionTransition, useReducedMotionPreference } from "../../../motion";
import { DrawnCheck, RingOnce, RollingNumber, SheenOnce } from "../components/FlowMotion";

import type { RoadmapDraftCheck, RoadmapDraftDetail } from "../../../types/roadmapV2Flow";

interface ChecksPanelProps {
  draft: RoadmapDraftDetail;
  /** The page's own count (it moves on autosave before the detail does). */
  met: number;
  total: number;
  readOnly: boolean;
  checking: boolean;
  onCheck: () => void;
  onNotQuite: (check: RoadmapDraftCheck) => void;
  onShowEvidence: (check: RoadmapDraftCheck) => void;
  onSubmit: () => void;
  /** Phone: Submit lives in the sticky bar instead. */
  hideSubmit?: boolean;
  /** Why Submit is locked although the checks are met (below the quality bar, or split); shown under it. */
  submitBlockedReason?: string | null;
}

/**
 * "Ready to submit?" (§4.2, §4.13): the checks (eight), each ticked one quoting the words that met
 * it, Not quite to reopen it, and Submit, which unlocks when all are met and the idea clears the
 * quality bar. Motion (§4.18): a check's circle
 * draws into a ✓; the counter rolls; at 5 of 5 the panel's border fills in a ring once and Submit
 * turns primary with one sheen; Not quite un-draws the ✓.
 */
export const ChecksPanel: React.FC<ChecksPanelProps> = ({
  draft,
  met,
  total,
  readOnly,
  checking,
  onCheck,
  onNotQuite,
  onShowEvidence,
  onSubmit,
  hideSubmit,
  submitBlockedReason,
}) => {
  const reduced = useReducedMotionPreference();
  const copy = en.roadmapV2.draft;
  const checks = Array.isArray(draft.checks) ? draft.checks : [];
  const complete = total > 0 && met >= total;

  // The ring and the sheen play once, on the turn that reaches 5 of 5 — not on load.
  const wasComplete = useRef(complete);
  const [celebrate, setCelebrate] = useState(false);
  useEffect(() => {
    if (complete && !wasComplete.current) setCelebrate(true);
    wasComplete.current = complete;
  }, [complete]);

  return (
    <section
      aria-label={copy.checksTitle}
      className={`relative flex flex-col gap-3 rounded-lg border p-4 transition-colors duration-200 ${
        complete ? "border-success-600" : "border-border-light"
      }`}
    >
      <RingOnce play={celebrate} />
      <header className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-sm font-semibold text-typography-primary">{copy.checksTitle}</h2>
        <span className="text-sm text-typography-secondary" aria-live="polite">
          <span className="sr-only">{copy.checksCountLong(met, total)}</span>
          <span aria-hidden className="inline-flex items-baseline gap-1">
            <RollingNumber value={met} /> of {total}
          </span>
        </span>
      </header>

      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {checks.map(check => (
          <CheckItem
            key={check.id}
            check={check}
            readOnly={readOnly}
            onNotQuite={() => onNotQuite(check)}
            onShowEvidence={() => onShowEvidence(check)}
          />
        ))}
      </ul>

      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2">
          <Button kind="tertiary" size="sm" onClick={onCheck} disabled={checking}>
            {checking ? copy.checking : copy.checkMyIdea}
          </Button>
          <Tooltip label={copy.checkMyIdeaHelp} align="bottom">
            <button
              type="button"
              className="inline-flex cursor-pointer items-center"
              aria-label={copy.checkMyIdeaHelp}
            >
              <TooltipIcon />
            </button>
          </Tooltip>
        </div>
      )}

      {!hideSubmit && !readOnly && (
        <div className="flex flex-col gap-1">
          <span className="relative inline-flex self-start overflow-hidden rounded">
            <Button
              kind={complete && !submitBlockedReason ? "primary" : "secondary"}
              size="md"
              disabled={!complete || !!submitBlockedReason}
              onClick={onSubmit}
            >
              {copy.submit}
            </Button>
            <SheenOnce play={celebrate} />
          </span>
          {!complete && (
            <span className="text-xs text-typography-secondary">
              {copy.submitLocked(met, total)}
            </span>
          )}
          {complete && submitBlockedReason && (
            <span className="text-xs text-typography-secondary">{submitBlockedReason}</span>
          )}
        </div>
      )}
      <AnimatePresence>
        {draft.selfChecked && (
          <motion.span
            className="text-xs text-typography-secondary"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={motionTransition("fast", "productive", reduced)}
          >
            {copy.selfChecked}
          </motion.span>
        )}
      </AnimatePresence>
    </section>
  );
};

const CheckItem: React.FC<{
  check: RoadmapDraftCheck;
  readOnly: boolean;
  onNotQuite: () => void;
  onShowEvidence: () => void;
}> = ({ check, readOnly, onNotQuite, onShowEvidence }) => {
  const reduced = useReducedMotionPreference();
  const copy = en.roadmapV2.draft;
  const quote = check.evidence?.quote;
  return (
    <li className="flex items-start gap-2" data-check={check.id} data-met={check.met || undefined}>
      <DrawnCheck met={check.met} className="mt-0.5" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm text-typography-primary">
          {check.label}
          <span className="sr-only"> · {check.met ? copy.checkMet : copy.checkOpen}</span>
        </span>
        <AnimatePresence initial={false}>
          {check.met && quote && (
            <motion.button
              type="button"
              onClick={onShowEvidence}
              className="self-start text-left text-xs italic text-typography-secondary hover:underline"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={motionTransition("moderate", "productive", reduced)}
            >
              {copy.evidence(quote)}
              {check.evidence?.from === "answer" && (
                <span className="not-italic"> · {copy.evidenceFromAnswer}</span>
              )}
              {check.source === "self" && <span className="not-italic"> · {copy.selfFilled}</span>}
            </motion.button>
          )}
        </AnimatePresence>
        {check.note && !check.met && (
          <span className="text-xs text-typography-secondary">{check.note}</span>
        )}
        {!check.met && !check.note && check.hint && (
          <span className="text-xs text-typography-secondary">{check.hint}</span>
        )}
      </div>
      {check.met && !readOnly && (
        <button
          type="button"
          onClick={onNotQuite}
          title={copy.notQuiteHelp}
          aria-describedby={`roadmap-not-quite-help-${check.id}`}
          className="min-h-6 shrink-0 rounded px-1.5 py-0.5 text-xs text-primary-700 hover:bg-neutral-100"
        >
          {copy.notQuite}
        </button>
      )}
      {check.met && !readOnly && (
        <span id={`roadmap-not-quite-help-${check.id}`} className="sr-only">
          {copy.notQuiteHelp}
        </span>
      )}
    </li>
  );
};
