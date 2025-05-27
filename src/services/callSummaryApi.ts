import {setSummaryData} from '@/store/slices/summarySlice';

import {api} from './api';

interface CallInfo {
  summaryName: string;
  clientTalkingTime: number;
  wordCountByLanguage: Record<string, number>;
  counselorTalkingTime: number;
  clientTalkingPercentage: string;
  counselorTalkingPercentage: string;
}

export interface Language {
  language: string;
  percentage: number;
}

export enum AgeRange {
  BELOW_18 = '0-17',
  EIGHTEEN_TO_TWENTY_FOUR = '18-24',
  TWENTY_FIVE_TO_THIRTY_FOUR = '25-34',
  THIRTY_FIVE_TO_FORTY_FOUR = '35-44',
  FORTY_FIVE_TO_FIFTY_FOUR = '45-54',
  FIFTY_FIVE_TO_SIXTY_FOUR = '55-64',
  SIXTY_FIVE_PLUS = '65+',
}

export interface SummaryDetails {
  // Features & Demographics
  callId: number | null;
  callDuration: number | null;
  callDate: string | null;
  callTime: string | null;
  clientId: string | null;
  counselorName: string | null;
  callType: string | null;
  age: AgeRange | null;
  gender: string | null;
  profession: string | null;
  relationshipStatus: string | null;
  languages: Language[] | null;
  location: string | null;
  codeOfConcern: string | null;

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
  listeningShare: number | null;
  reflectiveQuestionsAsked: number | null;
  emotionalLift: number | null;

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
      async onQueryStarted(_, {dispatch, queryFulfilled}) {
        const {data} = await queryFulfilled;
        dispatch(setSummaryData(data));
      },
    }),
    updateCallSummary: builder.mutation<
      CallSummaryResponse,
      {chatId: number; data: any}
    >({
      query: ({chatId, data}) => ({
        url: `/chats/${chatId}/call-details`,
        method: 'PUT',
        body: data,
      }),
      async onQueryStarted(_, {dispatch, queryFulfilled}) {
        const {data} = await queryFulfilled;
        dispatch(setSummaryData(data));
      },
    }),
    exportCallSummary: builder.query<string, number>({
      query: chatId => ({
        url: `/chats/${chatId}/export-summary`,
        responseHandler: async response => response.text(),
      }),
    }),
    updateCallInfo: builder.mutation<
      void,
      {chatId: number; summaryName: string}
    >({
      query: ({chatId, summaryName}) => ({
        url: `/chats/${chatId}/call-info`,
        method: 'PATCH',
        body: {summaryName},
      }),
    }),
    enhanceCallSummary: builder.mutation<void, {chatId: number; data: any}>({
      query: ({chatId, data}) => ({
        url: `/chats/${chatId}/call-info`,
        method: 'PATCH',
        body: data,
      }),
    }),
  }),
});

export const {
  useLazyGetCallSummaryQuery,
  useUpdateCallSummaryMutation,
  useLazyExportCallSummaryQuery,
  useUpdateCallInfoMutation,
  useEnhanceCallSummaryMutation,
} = callSummaryApi;
