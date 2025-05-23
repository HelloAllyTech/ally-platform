import {api} from './api';

interface SessionDetails {
  counselor_name: string | null;
  session_number: number | null;
  date_of_session: string | null;
  new_call_follow_up: string | null;
}

interface DemographicDetails {
  age: number | null;
  gender: string | null;
  location: string | null;
  client_id: number | null;
  working_status: string | null;
  code_of_concern: string | null;
  any_formal_diagnosis: string | null;
}

interface CounselorImpressions {
  client_attitude: string | null;
  problem_analysis: string | null;
  counselor_feelings: string | null;
  additional_insights: string | null;
  emotional_state_start: string | null;
  emotional_state_change: string | null;
}

interface FollowUpPlan {
  goals: string | null;
  status: string | null;
  follow_up_date: string | null;
}

interface WorkDone {
  homework: string | null;
  follow_up_plan: FollowUpPlan;
  issues_worked_on: string | null;
  counseling_process_flow: string | null;
  therapeutic_interventions: string | null;
}

interface SessionDocumentation {
  work_done: WorkDone;
  key_concerns: string | null;
  dominant_feelings: string[];
}

interface SummaryNote {
  session_details: SessionDetails;
  demographic_details: DemographicDetails;
  counselor_impressions: CounselorImpressions;
  session_documentation: SessionDocumentation;
}

interface Summary {
  tags: string[];
  callQuality: number;
  summaryNote: SummaryNote;
}

interface CallDetails {
  createdAt: string;
  updatedAt: string;
  tenantId: string;
  id: number;
  chatId: number;
  callDuration: number | null;
  startTime: string;
  endTime: string | null;
  noOfNudges: number | null;
  noOfStages: number | null;
  transcript: string | null;
  summary: Summary;
  callOutcome: string | null;
  callInfo: string | null;
}

export interface CallSummaryResponse {
  createdAt: string;
  updatedAt: string;
  tenantId: string;
  id: number;
  roomId: number;
  clientId: number;
  counselorId: number;
  status: string;
  startedAt: string;
  endedAt: string;
  details: CallDetails;
}

export const callSummaryApi = api.injectEndpoints({
  overrideExisting: true,
  endpoints: builder => ({
    getCallSummary: builder.query<CallSummaryResponse, number>({
      query: chatId => `/chats/${chatId}`,
    }),
    exportCallSummary: builder.query<void, number>({
      query: chatId => ({
        url: `/chats/${chatId}/export-summary`,
      }),
    }),
    deleteCallSummary: builder.mutation<void, number>({
      query: chatId => ({
        url: `/chats/${chatId}`,
        method: 'DELETE',
      }),
    }),
  }),
});

export const {
  useLazyGetCallSummaryQuery,
  useLazyExportCallSummaryQuery,
  useDeleteCallSummaryMutation,
} = callSummaryApi;
