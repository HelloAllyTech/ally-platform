import {api} from './api';

interface CallInfo {
  summaryName: string;
  clientTalkingTime: number;
  wordCountByLanguage: Record<string, number>;
  counselorTalkingTime: number;
  clientTalkingPercentage: string;
  counselorTalkingPercentage: string;
}

export interface SummaryDetails {
  // Features & Demographics
  callId: string | null;
  callDuration: number | null;
  dateOfSession: string | null;
  callTime: string | null;
  clientId: string | null;
  callType: string | null;
  age: number | null;
  gender: string | null;
  profession: string | null;
  location: string | null;
  languages: string | null;
  codeOfConcern: string | null;
  // TO DO: This field isn't available currently
  moodImprovedBy: number | null;
  counselorName: string | null;

  // Session Summary
  sessionSummary: string | null;

  // Flow
  counselingProcessFlow: string | null;

  // Key Concerns
  keyConcerns: string | null;

  // Observations and Assessment
  objectiveObservations: string | null;

  // Subjective Observations
  subjectiveObservations: string | null;

  // Assessment
  assessment: string | null;

  // Dominant Feelings
  dominantFeelings: string | null;

  // Issues Worked On
  issuesWorkedOn: string | null;

  // Key Therapeutic Techniques
  keyTherapeuticTechniques: string | null;

  // Referrals Provided
  referralsProvided: string | null;

  // Homework
  homework: string | null;

  // Plan for Next Call
  planForNextCall: string | null;
  tags: string | null;

  // Metrics
  metrics: {
    listeningRatio: number | null;
    reflectiveQuestionsAsked: number | null;
    emotionsLift: number | null;
  } | null;

  // Additional fields from response
  workingStatus: string | null;
  newCallFollowUp: string | null;
  counsellor: string | null;
  followUpGoals: string | null;
  sessionNumber: string | null;
  followUpStatus: string | null;
  followUpDate: string | null;
  counselorFeelings: string | null;
  anyFormalDiagnosis: string | null;
  relationshipStatus: string | null;
  emotionalStateStart: string | null;
  emotionalStateChange: string | null;
  therapeuticInterventions: string | null;
  callQuality: number | null;
}

interface CallDetails {
  createdAt: string;
  updatedAt: string;
  tenantId: string;
  id: number;
  chatId: number;
  callDuration: number;
  startTime: string;
  endTime: string | null;
  noOfNudges: number;
  noOfStages: number;
  transcript: string;
  summary: SummaryDetails;
  callOutcome: string | null;
  callInfo: CallInfo;
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
    updateCallSummary: builder.mutation({
      query: ({chatId, data}) => ({
        url: `/chats/${chatId}/call-details`,
        method: 'PUT',
        body: data,
      }),
    }),
    exportCallSummary: builder.query<string, number>({
      query: chatId => ({
        url: `/chats/${chatId}/export-summary`,
        responseHandler: async response => response.text(),
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
  useUpdateCallSummaryMutation,
  useLazyExportCallSummaryQuery,
  useDeleteCallSummaryMutation,
} = callSummaryApi;
