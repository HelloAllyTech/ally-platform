import React, { useState } from "react";

import { ChevronUp } from "@carbon/icons-react";
import { AnimatePresence, motion } from "framer-motion";
import { Link } from "react-router-dom";

import { Button, TextArea, TextInput } from "@ally-ui-mono/ui-shared";
import { useDismissManualDraftMutation, useSaveManualDraftMutation } from "@api";
import { ROUTES, en } from "@constants";
import type { ManualDraftCard } from "@types";

import {
  fadeUpVariants,
  listStaggerDelay,
  motionTransition,
  useReducedMotionPreference,
} from "../../../../motion";
import { visibleDrafts } from "../utils/chatState";
import { manualHref } from "../utils/wikilinks";

const statusOf = (error: unknown): number | undefined =>
  (error as { status?: number } | undefined)?.status;

const DraftCardView: React.FC<{
  draft: ManualDraftCard;
  conversationId: string | null;
  index: number;
  onChange: (patch: { savedCode?: string | null; discarded?: boolean }) => void;
}> = ({ draft, conversationId, index, onChange }) => {
  const copy = en.productManual.drafts;
  const reduced = useReducedMotionPreference();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(draft.title);
  const [text, setText] = useState(draft.text);
  const [error, setError] = useState<string | null>(null);
  const [save, { isLoading: saving }] = useSaveManualDraftMutation();
  const [dismiss, { isLoading: dismissing }] = useDismissManualDraftMutation();
  const saved = !!draft.savedCode;

  const onSave = async () => {
    if (!conversationId) return;
    setError(null);
    try {
      const result = await save({
        conversationId,
        draftId: draft.id,
        ...(text !== draft.text ? { text } : {}),
        ...(title !== draft.title ? { title } : {}),
      }).unwrap();
      setEditing(false);
      onChange({ savedCode: result.code });
    } catch (failure) {
      setError(statusOf(failure) === 403 ? copy.needsIdeaRole : copy.saveFailed);
    }
  };

  const onDismiss = async () => {
    if (!conversationId) return;
    setError(null);
    try {
      await dismiss({ conversationId, draftId: draft.id }).unwrap();
      onChange({ discarded: true });
    } catch {
      setError(copy.dismissFailed);
    }
  };

  return (
    <motion.li
      layout={!reduced}
      className={`flex flex-col gap-2 border p-3 ${
        saved ? "border-success-300 bg-success-50/40" : "border-border-light bg-white"
      }`}
      variants={fadeUpVariants(reduced, 8)}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={{
        ...motionTransition("moderate", "expressive", reduced),
        delay: listStaggerDelay(index, reduced),
      }}
      data-testid={`manual-draft-${draft.id}`}
    >
      {editing ? (
        <div className="flex flex-col gap-2">
          <TextInput
            id={`manual-draft-title-${draft.id}`}
            labelText={copy.titleField}
            size="sm"
            value={title}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => setTitle(event.target.value)}
          />
          <TextArea
            id={`manual-draft-text-${draft.id}`}
            labelText={copy.textField}
            rows={4}
            value={text}
            onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) =>
              setText(event.target.value)
            }
          />
        </div>
      ) : (
        <>
          <p className="m-0 text-sm font-semibold text-typography-900">{title}</p>
          <p className="m-0 line-clamp-4 whitespace-pre-wrap text-sm text-typography-700">{text}</p>
        </>
      )}
      {draft.relatedPages.length > 0 && (
        <ul aria-label={copy.related} className="m-0 flex list-none flex-wrap gap-1 p-0">
          {draft.relatedPages.map(page => (
            <li key={page.slug}>
              <Link
                to={manualHref(page.slug)}
                className="inline-flex rounded-full border border-border-light px-2 py-0.5 text-xs text-typography-700 hover:border-primary-500"
              >
                {page.title}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="m-0 text-xs text-destructive-600">
          {error}
        </p>
      )}
      {saved ? (
        <p role="status" className="m-0 flex items-center gap-1 text-xs text-typography-700">
          {copy.saved}{" "}
          <Link
            to={ROUTES.ROADMAP_IDEA(draft.savedCode as string)}
            className="font-semibold text-primary-700 hover:underline"
            aria-label={copy.openDraft(draft.savedCode as string)}
          >
            {draft.savedCode}
          </Link>
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-1">
          <Button kind="primary" size="sm" onClick={onSave} disabled={saving || !conversationId}>
            {saving ? copy.saving : copy.save}
          </Button>
          <Button kind="ghost" size="sm" onClick={() => setEditing(value => !value)}>
            {editing ? copy.done : copy.edit}
          </Button>
          <Button
            kind="ghost"
            size="sm"
            onClick={onDismiss}
            disabled={dismissing || !conversationId}
          >
            {copy.dismiss}
          </Button>
        </div>
      )}
    </motion.li>
  );
};

/**
 * Rough ideas the chat proposed, beside it: collapsible, with a count. Each card can be edited,
 * saved to My drafts (it then shows the draft's code) or dismissed. Nothing is saved until asked.
 */
export const DraftsTray: React.FC<{
  drafts: ManualDraftCard[];
  conversationId: string | null;
  onUpdate: (id: string, patch: { savedCode?: string | null; discarded?: boolean }) => void;
}> = ({ drafts, conversationId, onUpdate }) => {
  const copy = en.productManual.drafts;
  const reduced = useReducedMotionPreference();
  const shown = visibleDrafts(drafts);
  const [open, setOpen] = useState(true);
  if (shown.length === 0) return null;
  return (
    <section aria-label={copy.label} className="flex min-h-0 flex-col border-t border-border-light">
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        aria-expanded={open}
        aria-label={open ? copy.hide : copy.show}
        className="flex h-10 shrink-0 items-center gap-2 px-4 text-sm font-semibold text-typography-900 hover:bg-neutral-50"
      >
        {copy.title}
        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary-600 px-1.5 text-xs font-normal text-white">
          {shown.length}
        </span>
        <span className="sr-only">{copy.count(shown.length)}</span>
        <motion.span
          className="ml-auto flex"
          initial={false}
          animate={{ rotate: open ? 180 : 0 }}
          transition={motionTransition("fast", "productive", reduced)}
        >
          <ChevronUp size={16} aria-hidden />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="tray"
            className="min-h-0 overflow-hidden"
            initial={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
            animate={reduced ? { opacity: 1 } : { height: "auto", opacity: 1 }}
            exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={motionTransition("moderate", "productive", reduced)}
          >
            <ul className="m-0 flex max-h-[40vh] list-none flex-col gap-2 overflow-y-auto p-3 pt-0">
              <AnimatePresence initial={false}>
                {shown.map((draft, index) => (
                  <DraftCardView
                    key={draft.id}
                    draft={draft}
                    index={index}
                    conversationId={conversationId}
                    onChange={patch => onUpdate(draft.id, patch)}
                  />
                ))}
              </AnimatePresence>
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
};
