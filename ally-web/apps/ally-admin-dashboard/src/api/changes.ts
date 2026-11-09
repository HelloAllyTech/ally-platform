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

/** Change by chat on the assistant home (chunk 20a-2). */
export const changesApi = baseAPI.injectEndpoints({
  endpoints: builder => ({
    getChanges: builder.query<ChangeEntry[], string>({
      query: id => ({ url: ApiEndpoints.CHATBOTS.CHANGES(id), method: HttpMethod.GET }),
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
      invalidatesTags: [TAG_TYPES.CHECKUP],
    }),
    undoChange: builder.mutation<{ eventId: string }, { id: string; eventId: string }>({
      query: ({ id, eventId }) => ({
        url: ApiEndpoints.CHATBOTS.CHANGE_UNDO(id, eventId),
        method: HttpMethod.POST,
      }),
      invalidatesTags: [TAG_TYPES.CHECKUP],
    }),
  }),
});

export const {
  useGetChangesQuery,
  useProposeChangeMutation,
  useApplyChangeMutation,
  useUndoChangeMutation,
} = changesApi;
