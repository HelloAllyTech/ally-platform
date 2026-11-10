import { ApiEndpoints, HttpMethod, TAG_TYPES } from "@constants";

import { baseAPI } from "./baseApi";

/** One proposed change: a home field with its before and after, or a rule or topic added. */
export interface ProposedChange {
  field:
    | "assistant_name"
    | "introduction"
    | "tone"
    | "instructions"
    | "decline_text"
    | "suggested_questions"
    | "language"
    | "add_rule"
    | "avoid_topic";
  before?: unknown;
  after: unknown;
}

export interface ChangeProposal {
  refused: boolean;
  message: string;
  changes: ProposedChange[];
}

export interface ChangeEntry {
  id: string;
  at: string;
  kind: "patch" | "undo" | "change";
  summary: string;
  undone: boolean;
}

/** One line of the History (chunk 20d-2): a change by chat, or an edit by hand. */
export interface HistoryEntry {
  id: string;
  at: string;
  kind: "edit" | "change";
  origin: "panel" | "hand";
  who: string | null;
  fields: { field: string; before?: unknown; after: unknown }[];
  undone: boolean;
}

/** Change by chat on the assistant home (chunk 20a-2). */
export const changesApi = baseAPI.injectEndpoints({
  endpoints: builder => ({
    getChanges: builder.query<ChangeEntry[], string>({
      query: id => ({ url: ApiEndpoints.CHATBOTS.CHANGES(id), method: HttpMethod.GET }),
      // ally-be answers `{ changes: [...] }` (ChatbotChangesController).
      transformResponse: (response: { changes?: ChangeEntry[] }) => response.changes ?? [],
      providesTags: [TAG_TYPES.CHECKUP],
    }),
    proposeChange: builder.mutation<ChangeProposal, { id: string; request: string }>({
      query: ({ id, request }) => ({
        url: ApiEndpoints.CHATBOTS.CHANGES_PROPOSE(id),
        method: HttpMethod.POST,
        body: { request },
      }),
    }),
    applyChange: builder.mutation<{ eventId: string }, { id: string; changes: ProposedChange[] }>({
      query: ({ id, changes }) => ({
        url: ApiEndpoints.CHATBOTS.CHANGES_APPLY(id),
        method: HttpMethod.POST,
        body: { changes },
      }),
      invalidatesTags: (_r, _e, { id }) => [
        TAG_TYPES.CHECKUP,
        { type: TAG_TYPES.CHATBOT_DETAIL, id: `${id}:history` },
      ],
    }),
    /** Every change, newest first (chunk 20d-2). */
    getHistory: builder.query<HistoryEntry[], string>({
      query: id => ({ url: ApiEndpoints.CHATBOTS.HISTORY(id), method: HttpMethod.GET }),
      transformResponse: (response: { entries?: HistoryEntry[] }) => response.entries ?? [],
      providesTags: (_r, _e, id) => [{ type: TAG_TYPES.CHATBOT_DETAIL, id: `${id}:history` }],
    }),
    /** Undo an edit by hand (its before) or Restore one (its after). */
    revertEdit: builder.mutation<unknown, { id: string; eventId: string; to: "undo" | "restore" }>({
      query: ({ id, eventId, to }) => ({
        url: `${ApiEndpoints.CHATBOTS.HISTORY(id)}/${eventId}/${to}`,
        method: HttpMethod.POST,
      }),
      invalidatesTags: (_r, _e, { id }) => [
        { type: TAG_TYPES.CHATBOT_DETAIL, id: `${id}:history` },
        { type: TAG_TYPES.CHATBOT_DETAIL, id: `${id}:home` },
      ],
    }),
    undoChange: builder.mutation<{ eventId: string }, { id: string; eventId: string }>({
      query: ({ id, eventId }) => ({
        url: ApiEndpoints.CHATBOTS.CHANGE_UNDO(id, eventId),
        method: HttpMethod.POST,
      }),
      invalidatesTags: (_r, _e, { id }) => [
        TAG_TYPES.CHECKUP,
        { type: TAG_TYPES.CHATBOT_DETAIL, id: `${id}:history` },
      ],
    }),
  }),
});

export const {
  useGetChangesQuery,
  useProposeChangeMutation,
  useApplyChangeMutation,
  useUndoChangeMutation,
  useGetHistoryQuery,
  useRevertEditMutation,
} = changesApi;
