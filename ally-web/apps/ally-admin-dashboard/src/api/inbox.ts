import { ApiEndpoints, HttpMethod, TAG_TYPES } from "@constants";

import { baseAPI } from "./baseApi";

export type InboxChannel = "whatsapp" | "web" | "email";
/** The channel filter: a channel, or `widget`, the website widget's web chats (chunk 13). */
export type InboxChannelFilter = InboxChannel | "widget";
export type InboxView = "needs_person" | "live" | "all";

/** One chat in the inbox (ally-be `InboxService`). */
export interface InboxItem {
  id: string;
  chatbotId: string;
  assistant: string;
  channel: InboxChannel;
  /** `widget`: a chat started in the website widget (chunk 13), shown as "Website". */
  source: "widget" | null;
  visitor: string;
  preview: string;
  lastMessageAt: string;
  unread: number;
  state: "assistant" | "needs_person" | "held";
  needsPersonReason: "asked" | "declined_twice" | "assistant" | "crisis" | null;
  heldBy: { id: number; name: string | null } | null;
  safety: boolean;
  /** TF1 S5: one row per person; how many chats they have with this assistant. */
  chats?: number;
}

export interface InboxMessage {
  id: string;
  role: "user" | "assistant" | "agent_human";
  text: string;
  citations: { title?: string; source_url?: string | null }[];
  handledBy: string | null;
  at: string;
  sentBy: { id: number; name: string | null } | null;
  rating: "up" | "down" | null;
  ratingReason: string | null;
}

export interface InboxThread extends InboxItem {
  /** Whose chat it is (chunk 8a): what the assistant remembers is per person. */
  contactId: string | null;
  intake: { id: string; label: string; value: string }[];
  /** WhatsApp only: the team can reply until then. */
  replyWindowClosesAt: string | null;
  messages: InboxMessage[];
  /** TF1 S5: the person's other chats here, newest first. */
  otherChats?: { id: string; channel: InboxChannel; lastMessageAt: string; preview: string }[];
  /** TF1 S5: set when they have a newer chat on this channel, where replies reach them. */
  newerChatId?: string | null;
}

/** One thing the assistant remembers about a person (chunk 8a). */
export interface MemoryLine {
  id: string;
  section: "preferences" | "context" | "open_items";
  text: string;
  /** When they last said it. */
  saidAt: string;
  /** When it goes on its own; null: kept until forgotten. */
  expiresAt: string | null;
  /** `owner`: changed by someone on the team. */
  sourceKind: "person" | "owner";
  sourceMessageId: string | null;
  sourceConversationId: string | null;
}

export interface PersonMemory {
  /** False: the assistant doesn't remember people between chats. */
  on: boolean;
  name: string | null;
  /** The open chat's pre-chat answers the assistant reads (never phone or email). */
  beforeChat: { label: string; value: string }[];
  /** The open chat's rolling summary, when it has one. */
  summary: string | null;
  /** What it never keeps. */
  neverStore: string[];
  lines: MemoryLine[];
}

export interface InboxCounts {
  unread: number;
  needsPerson: number;
  safety: number;
}

/** The inbox (chunk 11a): every channel's chats, a person stepping in. */
export const inboxApi = baseAPI.injectEndpoints({
  endpoints: builder => ({
    getInbox: builder.query<
      InboxItem[],
      { view?: InboxView; channel?: InboxChannelFilter; chatbotId?: string }
    >({
      query: params => ({
        url: ApiEndpoints.INBOX.CONVERSATIONS,
        method: HttpMethod.GET,
        params,
      }),
      providesTags: [TAG_TYPES.INBOX],
    }),
    getInboxCounts: builder.query<InboxCounts, { chatbotId?: string } | void>({
      query: args => ({
        url: ApiEndpoints.INBOX.COUNTS,
        method: HttpMethod.GET,
        params: args && args.chatbotId ? { chatbotId: args.chatbotId } : undefined,
      }),
      providesTags: [TAG_TYPES.INBOX],
    }),
    getInboxThread: builder.query<InboxThread, { chatbotId: string; id: string }>({
      query: ({ chatbotId, id }) => ({
        url: ApiEndpoints.INBOX.THREAD(chatbotId, id),
        method: HttpMethod.GET,
      }),
      providesTags: [TAG_TYPES.INBOX],
    }),
    takeOver: builder.mutation<{ ok: true }, { chatbotId: string; id: string }>({
      query: ({ chatbotId, id }) => ({
        url: ApiEndpoints.INBOX.TAKE_OVER(chatbotId, id),
        method: HttpMethod.POST,
      }),
      invalidatesTags: [TAG_TYPES.INBOX],
    }),
    handBack: builder.mutation<{ ok: true }, { chatbotId: string; id: string }>({
      query: ({ chatbotId, id }) => ({
        url: ApiEndpoints.INBOX.HAND_BACK(chatbotId, id),
        method: HttpMethod.POST,
      }),
      invalidatesTags: [TAG_TYPES.INBOX],
    }),
    replyInInbox: builder.mutation<
      { messageId: string },
      { chatbotId: string; id: string; text: string }
    >({
      query: ({ chatbotId, id, text }) => ({
        url: ApiEndpoints.INBOX.REPLY(chatbotId, id),
        method: HttpMethod.POST,
        body: { text },
      }),
      invalidatesTags: [TAG_TYPES.INBOX],
    }),
    // What the assistant remembers (chunk 8a). Tagged with the inbox, so a new reply refreshes it.
    getPersonMemory: builder.query<
      PersonMemory,
      { chatbotId: string; contactId: string; conversationId?: string }
    >({
      query: ({ chatbotId, contactId, conversationId }) => ({
        url: ApiEndpoints.INBOX.MEMORY(chatbotId, contactId),
        method: HttpMethod.GET,
        params: conversationId ? { conversationId } : undefined,
      }),
      providesTags: [TAG_TYPES.INBOX],
    }),
    forgetMemoryLine: builder.mutation<{ forgotten: true }, { chatbotId: string; id: string }>({
      query: ({ chatbotId, id }) => ({
        url: ApiEndpoints.INBOX.FORGET_LINE(chatbotId, id),
        method: HttpMethod.POST,
      }),
      invalidatesTags: [TAG_TYPES.INBOX],
    }),
    editMemoryLine: builder.mutation<
      { id: string; text: string },
      { chatbotId: string; id: string; text: string }
    >({
      query: ({ chatbotId, id, text }) => ({
        url: ApiEndpoints.INBOX.MEMORY_LINE(chatbotId, id),
        method: HttpMethod.PATCH,
        body: { text },
      }),
      invalidatesTags: [TAG_TYPES.INBOX],
    }),
    forgetPerson: builder.mutation<{ forgotten: number }, { chatbotId: string; contactId: string }>(
      {
        query: ({ chatbotId, contactId }) => ({
          url: ApiEndpoints.INBOX.FORGET_PERSON(chatbotId, contactId),
          method: HttpMethod.POST,
        }),
        invalidatesTags: [TAG_TYPES.INBOX],
      },
    ),
  }),
});

export const {
  useGetInboxQuery,
  useGetInboxCountsQuery,
  useGetInboxThreadQuery,
  useTakeOverMutation,
  useHandBackMutation,
  useReplyInInboxMutation,
  useGetPersonMemoryQuery,
  useForgetMemoryLineMutation,
  useEditMemoryLineMutation,
  useForgetPersonMutation,
} = inboxApi;
