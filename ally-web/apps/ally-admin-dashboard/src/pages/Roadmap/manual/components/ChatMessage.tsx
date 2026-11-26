import React, { useState } from "react";

import { CheckmarkOutline, Document, Edit, WarningAlt } from "@carbon/icons-react";
import { AnimatePresence, motion } from "framer-motion";
import { Link } from "react-router-dom";

import { InlineLoading } from "@ally-ui-mono/ui-shared";
import { en } from "@constants";

import { MarkdownBody } from "./MarkdownBody";
import {
  fadeUpVariants,
  motionTransition,
  popVariants,
  useReducedMotionPreference,
} from "../../../../motion";
import { ThinkingLine } from "../../drafts/DraftConversation";
import { ManualChatEdit, ManualChatMessage, activityText } from "../utils/chatState";
import { manualHref } from "../utils/wikilinks";

type UndoState = "idle" | "working" | "done" | "failed";

/** "Edited <page> · Undo": the chat changed a page live; one click takes it back. */
const EditChip: React.FC<{
  edit: ManualChatEdit;
  onUndo: (edit: ManualChatEdit) => Promise<boolean>;
  onViewChange: (slug: string) => void;
}> = ({ edit, onUndo, onViewChange }) => {
  const copy = en.productManual.chat;
  const reduced = useReducedMotionPreference();
  const [state, setState] = useState<UndoState>("idle");
  const undo = async () => {
    setState("working");
    setState((await onUndo(edit)) ? "done" : "failed");
  };
  return (
    <motion.span
      className="inline-flex items-center gap-1.5 rounded-full border border-border-light bg-neutral-50 px-3 py-1 text-xs text-typography-700"
      variants={popVariants(reduced)}
      initial="initial"
      animate="animate"
      transition={motionTransition("fast", "productive", reduced)}
      title={edit.reason ?? undefined}
    >
      <Edit size={12} aria-hidden />
      <Link to={manualHref(edit.slug)} className="font-medium text-typography-900 hover:underline">
        {copy.edited(edit.title)}
      </Link>
      <span aria-hidden>·</span>
      {state === "idle" && (
        <button type="button" onClick={undo} className="text-primary-700 hover:underline">
          {copy.undo}
        </button>
      )}
      {state === "working" && <InlineLoading className="!min-h-0 !w-auto" />}
      {state === "done" && <span role="status">{copy.undone(edit.title)}</span>}
      {state === "failed" && (
        <button
          type="button"
          onClick={() => onViewChange(edit.slug)}
          className="text-primary-700 hover:underline"
        >
          {copy.viewChange}
        </button>
      )}
    </motion.span>
  );
};

/** While the answer runs: one line per lookup. Afterwards: "Looked at N things", folded. */
const Activity: React.FC<{ message: ManualChatMessage }> = ({ message }) => {
  const copy = en.productManual.chat;
  const reduced = useReducedMotionPreference();
  if (message.activity.length === 0) return null;
  if (message.status === "streaming") {
    return (
      <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-live="polite">
        <AnimatePresence initial={false}>
          {message.activity.map(item => (
            <motion.li
              key={item.id}
              className="flex items-center gap-2 text-xs text-typography-600"
              variants={fadeUpVariants(reduced)}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={motionTransition("fast", "productive", reduced)}
            >
              {item.ok === null ? (
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary-500 motion-reduce:animate-none" />
              ) : item.ok ? (
                <CheckmarkOutline size={12} aria-hidden className="text-success-600" />
              ) : (
                <WarningAlt size={12} aria-hidden className="text-warning-700" />
              )}
              <span className="min-w-0 truncate">{activityText(item, copy.couldntCheck)}</span>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    );
  }
  const failed = message.activity.filter(item => item.ok === false);
  return (
    <div className="flex flex-col gap-1 text-xs text-typography-500">
      <details>
        <summary className="cursor-pointer select-none hover:text-typography-700">
          {copy.lookedAt(message.activity.length)}
        </summary>
        <ul className="m-0 mt-1 flex list-none flex-col gap-0.5 border-l border-border-light pl-3">
          {message.activity.map(item => (
            <li key={item.id} className="break-words">
              {activityText(item, copy.couldntCheck)}
            </li>
          ))}
        </ul>
      </details>
      {/* A lookup that failed is never folded away. */}
      {failed.map(item => (
        <p key={item.id} className="m-0 flex items-center gap-1 text-warning-700">
          <WarningAlt size={12} aria-hidden />
          {activityText(item, copy.couldntCheck)}
        </p>
      ))}
    </div>
  );
};

export interface ManualChatMessageViewProps {
  message: ManualChatMessage;
  contextTitle?: string | null;
  onUndo: (edit: ManualChatEdit) => Promise<boolean>;
  onViewChange: (slug: string) => void;
}

export const ManualChatMessageView: React.FC<ManualChatMessageViewProps> = ({
  message,
  contextTitle,
  onUndo,
  onViewChange,
}) => {
  const copy = en.productManual.chat;
  const reduced = useReducedMotionPreference();
  const motionProps = {
    variants: fadeUpVariants(reduced, 6),
    initial: "initial" as const,
    animate: "animate" as const,
    transition: motionTransition("moderate", "productive", reduced),
  };

  if (message.role === "user") {
    return (
      <motion.div className="flex flex-col items-end gap-1" {...motionProps}>
        <span className="sr-only">{copy.you}</span>
        {(message.context?.selection || contextTitle) && (
          <div className="max-w-[90%] border-l-2 border-primary-300 pl-2 text-xs text-typography-600">
            {contextTitle && <p className="m-0">{copy.context(contextTitle)}</p>}
            {message.context?.selection && (
              <p className="m-0 line-clamp-3 italic">“{message.context.selection}”</p>
            )}
          </div>
        )}
        <p className="m-0 max-w-[90%] whitespace-pre-wrap bg-neutral-100 px-3 py-2 text-sm text-typography-900">
          {message.content}
        </p>
      </motion.div>
    );
  }

  const waiting =
    message.status === "streaming" &&
    !message.content &&
    message.activity.every(item => item.ok !== null);
  return (
    <motion.div className="flex flex-col gap-2" {...motionProps}>
      <span className="sr-only">{copy.manual}</span>
      <Activity message={message} />
      {waiting && <ThinkingLine label={copy.thinking} />}
      {message.content && (
        <div className="text-sm" aria-busy={message.status === "streaming"}>
          <MarkdownBody body={message.content} variant="chat" />
        </div>
      )}
      {message.citations.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-xs text-typography-600">{copy.sources}</span>
          <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
            {message.citations.map(citation => (
              <motion.li
                key={citation.slug}
                variants={popVariants(reduced)}
                initial="initial"
                animate="animate"
                transition={motionTransition("fast", "productive", reduced)}
              >
                <Link
                  to={manualHref(citation.slug)}
                  className="inline-flex items-center gap-1 rounded-full border border-border-light bg-white px-2.5 py-0.5 text-xs text-typography-800 hover:border-primary-500"
                >
                  <Document size={12} aria-hidden />
                  {citation.title}
                </Link>
              </motion.li>
            ))}
          </ul>
        </div>
      )}
      {message.edits.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {message.edits.map(edit => (
            <EditChip
              key={edit.revisionId}
              edit={edit}
              onUndo={onUndo}
              onViewChange={onViewChange}
            />
          ))}
        </div>
      )}
      {message.status === "error" && message.error && (
        <p role="alert" className="m-0 text-sm text-destructive-600">
          {message.error}
        </p>
      )}
      {message.status === "stopped" && (
        <p className="m-0 text-xs text-typography-500">{message.error ?? copy.stopped}</p>
      )}
    </motion.div>
  );
};
