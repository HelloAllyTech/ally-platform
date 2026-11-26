import React, { useEffect, useRef, useState } from "react";

import { Add, Close, Send, StopFilledAlt, TrashCan } from "@carbon/icons-react";
import { toast } from "sonner";

import { Modal, OverflowMenu, OverflowMenuItem } from "@ally-ui-mono/ui-shared";
import {
  useDeleteManualConversationMutation,
  useGetManualConversationsQuery,
  useLazyGetManualChangesQuery,
  useLazyGetManualConversationQuery,
  useRevertManualPageMutation,
} from "@api";
import { en } from "@constants";

import { ManualChatMessageView } from "./ChatMessage";
import { DraftsTray } from "./DraftsTray";
import { MANUAL_MESSAGE_MAX, ManualChatStream } from "../hooks/useManualChatStream";
import { useManualData } from "../hooks/useManualData";
import { ManualChatEdit } from "../utils/chatState";
import { pickRevertTarget } from "../utils/revertTarget";

/** The starter prompts for an empty chat; the usage one only when the Analytics Agent is there. */
export const starterPrompts = (analyticsAvailable: boolean): string[] => {
  const copy = en.productManual.chat;
  return analyticsAvailable ? [...copy.starters, copy.usageStarter] : [...copy.starters];
};

const iconButton =
  "flex h-8 w-8 items-center justify-center text-typography-700 hover:bg-neutral-100 disabled:opacity-40";

export interface ChatPanelProps {
  stream: ManualChatStream;
  analyticsAvailable: boolean;
  onClose: () => void;
  onViewChange: (slug: string) => void;
  /** Text to put in the composer (the palette's "Ask the manual about …"); `nonce` re-applies it. */
  prefill?: { text: string; nonce: number } | null;
  /** The page being read: sent as context with a typed question. */
  pageSlug?: string | null;
}

/**
 * Ask the manual: the conversation, its composer and the drafts tray. One answer streams at a
 * time; Stop ends it and keeps what arrived. Live edits the chat makes to a page show as a chip
 * with Undo (revert to the revision before the edit).
 */
export const ChatPanel: React.FC<ChatPanelProps> = ({
  stream,
  analyticsAvailable,
  onClose,
  onViewChange,
  prefill,
  pageSlug,
}) => {
  const copy = en.productManual.chat;
  const { bySlug } = useManualData();
  const { state, send, stop, load, reset, updateDraft } = stream;
  const [draft, setDraft] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const { data: conversations = [] } = useGetManualConversationsQuery();
  const [fetchConversation] = useLazyGetManualConversationQuery();
  const [deleteConversation, { isLoading: deleting }] = useDeleteManualConversationMutation();
  const [fetchChanges] = useLazyGetManualChangesQuery();
  const [revert] = useRevertManualPageMutation();

  useEffect(() => {
    if (!prefill) return;
    setDraft(prefill.text);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [prefill]);

  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const last = state.messages[state.messages.length - 1];
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [state.messages.length, last?.content.length, last?.activity.length]);

  const submit = () => {
    const text = draft.trim();
    if (!text || state.streaming) return;
    setDraft("");
    void send(text, pageSlug ? { pageSlug } : undefined);
  };

  const openConversation = async (id: string) => {
    if (id === state.conversationId) return;
    try {
      load(await fetchConversation(id).unwrap());
    } catch {
      toast.error(copy.loadFailed);
    }
  };

  const onDelete = async () => {
    if (!state.conversationId) return;
    try {
      await deleteConversation(state.conversationId).unwrap();
      reset();
      toast.success(copy.deleted);
    } catch {
      toast.error(copy.deleteFailed);
    } finally {
      setConfirmDelete(false);
    }
  };

  const undo = async (edit: ManualChatEdit): Promise<boolean> => {
    try {
      const changes = await fetchChanges({ slug: edit.slug, limit: 50 }).unwrap();
      const target = pickRevertTarget(changes, edit.revisionId, edit.slug);
      if (!target) return false;
      await revert({ slug: edit.slug, revisionId: target.id }).unwrap();
      return true;
    } catch {
      toast.error(copy.undoFailed);
      return false;
    }
  };

  const contextTitle = (slug?: string) => (slug ? (bySlug.get(slug)?.title ?? null) : null);
  const starters = starterPrompts(analyticsAvailable);
  const current = conversations.find(item => item.id === state.conversationId);

  return (
    <section aria-label={copy.label} className="flex h-full min-h-0 flex-col bg-white">
      <header className="flex h-12 shrink-0 items-center gap-1 border-b border-border-light pl-4 pr-2">
        <h2 className="m-0 min-w-0 flex-1 truncate text-sm font-semibold text-typography-900">
          {current?.title || copy.title}
        </h2>
        <OverflowMenu
          aria-label={copy.conversations}
          iconDescription={copy.conversations}
          flipped
          size="sm"
          menuOptionsClass="!w-72 [&_.cds--overflow-menu-options\_\_btn]:!max-w-none"
        >
          {conversations.length === 0 ? (
            <OverflowMenuItem itemText={copy.noConversations} disabled />
          ) : (
            conversations
              .slice(0, 20)
              .map(item => (
                <OverflowMenuItem
                  key={item.id}
                  itemText={`${item.id === state.conversationId ? "✓ " : ""}${item.title || copy.untitled}`}
                  onClick={() => void openConversation(item.id)}
                />
              ))
          )}
        </OverflowMenu>
        <button
          type="button"
          className={iconButton}
          aria-label={copy.newChat}
          title={copy.newChat}
          onClick={() => {
            reset();
            setDraft("");
            inputRef.current?.focus();
          }}
        >
          <Add size={16} aria-hidden />
        </button>
        <button
          type="button"
          className={iconButton}
          aria-label={copy.deleteChat}
          title={copy.deleteChat}
          disabled={!state.conversationId || state.streaming}
          onClick={() => setConfirmDelete(true)}
        >
          <TrashCan size={16} aria-hidden />
        </button>
        <button
          type="button"
          className={iconButton}
          aria-label={en.productManual.closeAsk}
          title={en.productManual.closeAsk}
          onClick={onClose}
        >
          <Close size={16} aria-hidden />
        </button>
      </header>

      <div className="manual-scroll min-h-0 flex-1 overflow-y-auto px-4 py-4" aria-live="polite">
        {state.messages.length === 0 ? (
          <div className="flex flex-col gap-3">
            <p className="m-0 text-xs font-semibold text-typography-600">{copy.starterTitle}</p>
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {starters.map(prompt => (
                <li key={prompt}>
                  <button
                    type="button"
                    onClick={() => void send(prompt, pageSlug ? { pageSlug } : undefined)}
                    className="w-full border border-border-light px-3 py-2 text-left text-sm text-typography-800 transition-colors duration-100 hover:border-primary-500 hover:bg-primary-50"
                  >
                    {prompt}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            {state.messages.map(message => (
              <ManualChatMessageView
                key={message.id}
                message={message}
                contextTitle={
                  message.role === "user" && message.context?.selection
                    ? contextTitle(message.context.pageSlug)
                    : null
                }
                onUndo={undo}
                onViewChange={onViewChange}
              />
            ))}
          </div>
        )}
        <div ref={endRef} />
      </div>

      <DraftsTray
        drafts={state.drafts}
        conversationId={state.conversationId}
        onUpdate={updateDraft}
      />

      <form
        className="flex shrink-0 items-end gap-2 border-t border-border-light p-3"
        onSubmit={event => {
          event.preventDefault();
          submit();
        }}
      >
        <label className="sr-only" htmlFor="manual-chat-input">
          {copy.placeholder}
        </label>
        <textarea
          id="manual-chat-input"
          ref={inputRef}
          rows={1}
          value={draft}
          maxLength={MANUAL_MESSAGE_MAX}
          placeholder={copy.placeholder}
          onChange={event => setDraft(event.target.value)}
          onKeyDown={event => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submit();
            }
          }}
          className="max-h-40 min-h-10 flex-1 resize-none border-0 border-b border-neutral-400 bg-neutral-50 px-3 py-2 text-sm text-typography-900 outline-none focus:border-primary-600"
          style={{ fieldSizing: "content" } as React.CSSProperties}
        />
        {state.streaming ? (
          <button
            type="button"
            onClick={stop}
            aria-label={copy.stop}
            title={copy.stop}
            className="flex h-10 w-10 shrink-0 items-center justify-center bg-neutral-900 text-white"
          >
            <StopFilledAlt size={16} aria-hidden />
          </button>
        ) : (
          <button
            type="submit"
            aria-label={copy.send}
            title={copy.send}
            disabled={!draft.trim()}
            className="flex h-10 w-10 shrink-0 items-center justify-center bg-primary-600 text-white disabled:bg-neutral-200 disabled:text-typography-500"
          >
            <Send size={16} aria-hidden />
          </button>
        )}
      </form>

      <Modal
        open={confirmDelete}
        danger
        size="xs"
        modalHeading={copy.deleteTitle}
        primaryButtonText={copy.deleteConfirm}
        secondaryButtonText={copy.cancel}
        primaryButtonDisabled={deleting}
        onRequestClose={() => setConfirmDelete(false)}
        onRequestSubmit={onDelete}
      >
        <p className="text-sm text-typography-800">{copy.deleteBody}</p>
      </Modal>
    </section>
  );
};
