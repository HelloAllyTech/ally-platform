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
  needsPersonReason: "asked" | "declined_twice" | "assistant" | null;
  heldBy: { id: number; name: string | null } | null;
  safety: boolean;
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
  intake: { id: string; label: string; value: string }[];
  /** WhatsApp only: the team can reply until then. */
  replyWindowClosesAt: string | null;
  messages: InboxMessage[];
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
    getInboxCounts: builder.query<InboxCounts, void>({
      query: () => ({ url: ApiEndpoints.INBOX.COUNTS, method: HttpMethod.GET }),
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
  }),
});

export const {
  useGetInboxQuery,
  useGetInboxCountsQuery,
  useGetInboxThreadQuery,
  useTakeOverMutation,
  useHandBackMutation,
  useReplyInInboxMutation,
} = inboxApi;
