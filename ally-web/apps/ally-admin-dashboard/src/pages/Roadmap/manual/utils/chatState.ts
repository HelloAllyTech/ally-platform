import type { ManualChatContext, ManualConversation, ManualDraftCard, ManualPageRef } from "@types";

/**
 * The manual chat as state: messages (with each answer's live activity, citations and edits) and
 * the drafts tray. `applyManualChatEvent` is the one pure reducer for both the server's SSE events
 * (`ally-be/docs/product-manual.md` → Chat) and the client's own actions, so the whole conversation
 * is testable without a network.
 */

export interface ManualChatActivity {
  id: string;
  label: string;
  summary: string | null;
  ok: boolean | null;
}

export interface ManualChatEdit {
  slug: string;
  title: string;
  revisionId: string;
  reason: string | null;
}

export type ManualMessageStatus = "streaming" | "done" | "error" | "stopped";

export interface ManualChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations: ManualPageRef[];
  edits: ManualChatEdit[];
  activity: ManualChatActivity[];
  status: ManualMessageStatus;
  error: string | null;
  context: ManualChatContext | null;
}

export interface ManualChatState {
  conversationId: string | null;
  // Empty arrays, never null, so the views render without guards [FP-3140].
  messages: ManualChatMessage[];
  drafts: ManualDraftCard[];
  streaming: boolean;
}

export const initialManualChatState: ManualChatState = {
  conversationId: null,
  messages: [],
  drafts: [],
  streaming: false,
};

/** What the server streams. */
export type ManualChatServerEvent =
  | { type: "meta"; data: { conversationId: string; messageId: string } }
  | { type: "activity"; data: { id: string; label: string } }
  | { type: "activity_done"; data: { id: string; summary: string; ok: boolean } }
  | { type: "token"; data: { text: string } }
  | { type: "citation"; data: ManualPageRef }
  | {
      type: "draft";
      data: { id: string; title: string; text: string; relatedPages?: ManualPageRef[] };
    }
  | {
      type: "page_edited";
      data: { slug: string; title: string; revisionId: string; reason?: string | null };
    }
  | { type: "error"; data: { message: string } }
  | { type: "done"; data: { messageId?: string } };

/** What the client does to the same state. */
export type ManualChatLocalAction =
  | { type: "local_send"; data: { localId: string; message: string; context?: ManualChatContext } }
  | { type: "local_fail"; data: { message: string } }
  | { type: "local_abort"; data: { message: string } }
  | { type: "local_load"; data: ManualConversation }
  | { type: "local_reset" }
  | { type: "local_draft"; data: { id: string } & Partial<ManualDraftCard> };

export type ManualChatEvent = ManualChatServerEvent | ManualChatLocalAction;

const SERVER_EVENTS = new Set([
  "meta",
  "activity",
  "activity_done",
  "token",
  "citation",
  "draft",
  "page_edited",
  "error",
  "done",
]);

export const isManualChatServerEvent = (event: {
  type: string;
  data: unknown;
}): event is ManualChatServerEvent => SERVER_EVENTS.has(event.type);

/** Applies `update` to the answer being streamed (the last assistant message still streaming). */
const updateStreaming = (
  state: ManualChatState,
  update: (message: ManualChatMessage) => ManualChatMessage,
): ManualChatState => {
  for (let index = state.messages.length - 1; index >= 0; index -= 1) {
    const message = state.messages[index];
    if (message.role === "assistant" && message.status === "streaming") {
      const messages = state.messages.slice();
      messages[index] = update(message);
      return { ...state, messages };
    }
  }
  return state;
};

const settle = (
  state: ManualChatState,
  status: ManualMessageStatus,
  error: string | null,
): ManualChatState => ({
  ...updateStreaming(state, message => ({
    ...message,
    status,
    error,
    // Anything still marked as running ends with the answer.
    activity: message.activity.map(item =>
      item.ok === null ? { ...item, ok: status === "done" } : item,
    ),
  })),
  streaming: false,
});

const emptyMessage = (
  id: string,
  role: "user" | "assistant",
  content: string,
  status: ManualMessageStatus,
  context: ManualChatContext | null = null,
): ManualChatMessage => ({
  id,
  role,
  content,
  citations: [],
  edits: [],
  activity: [],
  status,
  error: null,
  context,
});

export const applyManualChatEvent = (
  state: ManualChatState,
  event: ManualChatEvent,
): ManualChatState => {
  switch (event.type) {
    case "local_send": {
      const { localId, message, context } = event.data;
      return {
        ...state,
        streaming: true,
        messages: [
          ...state.messages,
          emptyMessage(`${localId}-user`, "user", message, "done", context ?? null),
          emptyMessage(`${localId}-answer`, "assistant", "", "streaming"),
        ],
      };
    }
    case "meta":
      return {
        ...updateStreaming(state, message => ({ ...message, id: event.data.messageId })),
        conversationId: event.data.conversationId || state.conversationId,
      };
    case "activity":
      return updateStreaming(state, message =>
        message.activity.some(item => item.id === event.data.id)
          ? message
          : {
              ...message,
              activity: [
                ...message.activity,
                { id: event.data.id, label: event.data.label, summary: null, ok: null },
              ],
            },
      );
    case "activity_done":
      return updateStreaming(state, message => ({
        ...message,
        activity: message.activity.map(item =>
          item.id === event.data.id
            ? { ...item, summary: event.data.summary ?? null, ok: event.data.ok !== false }
            : item,
        ),
      }));
    case "token":
      return updateStreaming(state, message => ({
        ...message,
        content: message.content + (event.data.text ?? ""),
      }));
    case "citation":
      return updateStreaming(state, message =>
        message.citations.some(citation => citation.slug === event.data.slug)
          ? message
          : {
              ...message,
              citations: [...message.citations, { slug: event.data.slug, title: event.data.title }],
            },
      );
    case "draft": {
      if (state.drafts.some(draft => draft.id === event.data.id)) return state;
      return {
        ...state,
        drafts: [
          ...state.drafts,
          {
            id: event.data.id,
            title: event.data.title,
            text: event.data.text,
            relatedPages: event.data.relatedPages ?? [],
            savedCode: null,
            discarded: false,
          },
        ],
      };
    }
    case "page_edited":
      return updateStreaming(state, message => ({
        ...message,
        edits: [
          ...message.edits.filter(edit => edit.revisionId !== event.data.revisionId),
          {
            slug: event.data.slug,
            title: event.data.title,
            revisionId: event.data.revisionId,
            reason: event.data.reason ?? null,
          },
        ],
      }));
    case "error":
    case "local_fail":
      return settle(state, "error", event.data.message);
    case "local_abort":
      return settle(state, "stopped", event.data.message);
    case "done": {
      const next = event.data?.messageId
        ? updateStreaming(state, message => ({ ...message, id: event.data.messageId as string }))
        : state;
      return settle(next, "done", null);
    }
    case "local_load": {
      const conversation = event.data;
      return {
        conversationId: conversation.id,
        streaming: false,
        drafts: (conversation.drafts ?? []).map(draft => ({
          ...draft,
          relatedPages: draft.relatedPages ?? [],
        })),
        // Saved messages carry `text`, citations and edits; no activity was kept.
        messages: (conversation.messages ?? []).map(message => ({
          ...emptyMessage(message.id, message.role, message.text ?? "", "done"),
          citations: message.citations ?? [],
          edits: (message.edits ?? []).map(edit => ({ ...edit, reason: edit.reason ?? null })),
        })),
      };
    }
    case "local_reset":
      return initialManualChatState;
    case "local_draft":
      return {
        ...state,
        drafts: state.drafts.map(draft =>
          draft.id === event.data.id ? { ...draft, ...event.data } : draft,
        ),
      };
    default:
      return state;
  }
};

/** Drafts still worth showing in the tray: not dismissed. */
export const visibleDrafts = (drafts: ManualDraftCard[]): ManualDraftCard[] =>
  drafts.filter(draft => !draft.discarded);

/**
 * What an activity line says. A failed lookup shows its summary only when it reads as a sentence;
 * a bare or embedded code ("github_not_configured") is never shown — `fallback` is said instead.
 */
export const activityText = (item: ManualChatActivity, fallback: string): string => {
  if (item.ok !== false) return item.summary ?? item.label;
  const summary = item.summary?.trim() ?? "";
  const sentence = /\s/.test(summary) && !/[A-Za-z0-9]+_[A-Za-z0-9_]+/.test(summary);
  return sentence ? summary : fallback;
};
