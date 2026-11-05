import {API_METHODS, API_ROUTES, ChatSummaryStatus} from '@/constants';
import {setSummaryData} from '@/store/slices/summarySlice';
import {ChatProvider} from '@/types';

import {api} from './api';

export interface CallInfo {
  summaryName: string;
  isSummaryFeedbackAdded: boolean;
  clientWordCount?: number;
  clientTalkingTime: number;
  wordCountByLanguage: Record<string, number>;
  counselorWordCount?: number;
  counselorTalkingTime: number;
  clientTalkingPercentage: string;
  counselorTalkingPercentage: string;
  provider: ChatProvider;
  mode?: string;
  notes: string | null;
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
  counsellor: string | null;
  callType: string | null;
  age: AgeRange | null;
  gender: string | null;
  profession: string | null;
  relationshipStatus: string | null;
  languages: Language[] | null;
  location: string | null;
  codeOfConcern: string | null;
  newCallFollowUp: string | null;

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
  tags: Tag[] | null;

  // Metrics
  listeningShare: number | null;
  reflectiveQuestionsAsked: number | null;
  openEndedQuestionsAsked: number | null;
  emotionalLift: number | null;

  // Intake section
  intakeNotes: string | null;
  riskSelfHarm: string | null;
  riskSelfHarmNotes: string | null;
  riskSuicidalThoughts: string | null;
  riskSuicidalThoughtsNotes: string | null;
  riskSuicidalPlan: string | null;
  riskSuicidalAction: string | null;
  riskRunningAway: string | null;
  riskRunningAwayNotes: string | null;
  traumaPhysicalAbuse: string | null;
  traumaSexualAbuse: string | null;
  traumaVerbalAbuse: string | null;
  traumaNeglect: string | null;
  traumaSeparationFromCaregiverParent: string | null;
  traumaWitnessedDomesticViolence: string | null;
  traumaNotes: string | null;
  assessmentPsychologicalDiagnosis: string | null;
  assessmentPsychologicalDiagnosisNotes: string | null;
  assessmentUseOfPsychotropicMedications: string | null;
  assessmentUseOfPsychotropicMedicationsNotes: string | null;
  assessmentHallucinations: string | null;
  assessmentHallucinationsNotes: string | null;
  assessmentAffect: string | null;
  assessmentSpeech: string | null;

  // Ongoing Risks section
  ongoingRiskSelfHarm: string | null;
  ongoingRiskSelfHarmNotes: string | null;
  ongoingRiskSuicidalThoughts: string | null;
  ongoingRiskSuicidalPlan: string | null;
  ongoingRiskSuicidalAction: string | null;
  ongoingRiskSuicidalThoughtsNotes: string | null;

  // Additional fields from response
  workingStatus: string | null;
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
  additionalNotes: string | null;
}

export interface CallDetails {
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
  archivedAt: string;
  details: CallDetails;
  summaryStatus: ChatSummaryStatus;
  reviewId?: string | null;
  reviewStatus?: string | null;
  reviewNote?: string | null;
  reviewCreatedAt?: string | null;
  reviewUpdatedAt?: string | null;
}

export interface Tag {
  tag: string;
  priority_rating: number;
}

export const callSummaryApi = api.injectEndpoints({
  overrideExisting: true,
  endpoints: builder => ({
    getCallSummary: builder.query<CallSummaryResponse, number>({
      query: chatId => API_ROUTES.CHATS.BY_ID(chatId),
      async onQueryStarted(_, {dispatch, queryFulfilled}) {
        const {data} = await queryFulfilled;
        dispatch(setSummaryData(data));
      },
    }),
    updateCallSummary: builder.mutation<
      CallSummaryResponse,
      {chatId: number; data: any} // eslint-disable-line @typescript-eslint/no-explicit-any
    >({
      query: ({chatId, data}) => ({
        url: API_ROUTES.CHATS.CALL_DETAILS(chatId),
        method: API_METHODS.PUT,
        body: data,
      }),
      async onQueryStarted(_, {dispatch, queryFulfilled}) {
        const {data} = await queryFulfilled;
        dispatch(setSummaryData(data));
      },
    }),
    exportCallSummary: builder.query<string, number>({
      query: chatId => ({
        url: API_ROUTES.CHATS.EXPORT_SUMMARY(chatId),
        responseHandler: async response => response.text(),
      }),
    }),
    updateCallInfo: builder.mutation<
      void,
      {chatId: number; summaryName: string}
    >({
      query: ({chatId, summaryName}) => ({
        url: API_ROUTES.CHATS.CALL_INFO(chatId),
        method: API_METHODS.PATCH,
        body: {summaryName},
      }),
    }),
    enhanceCallSummary: builder.mutation<
      {enhanced_content: string},
      {content: string}
    >({
      query: ({content}) => ({
        url: API_ROUTES.CHATS.ENHANCE,
        method: API_METHODS.POST,
        body: {content},
      }),
    }),
    getTags: builder.mutation<Tag[], {tags: string[]}>({
      query: body => ({
        url: API_ROUTES.CHATS.SUMMARY_TAG_RATINGS,
        method: API_METHODS.POST,
        body,
      }),
    }),
    addSummaryFeedback: builder.mutation<
      {success: boolean},
      {
        chatId: number;
        rating: number;
        feedback: {issues: string[]; comment: string};
      }
    >({
      query: ({chatId, rating, feedback}) => ({
        url: API_ROUTES.CHATS.SUMMARY_FEEDBACK(chatId),
        method: 'POST',
        body: {
          rating,
          feedback,
        },
      }),
    }),
    // Regenerate the summary for a session whose transcript was saved but whose
    // summary failed (mirrors the web "Retry summary" action). The backend also
    // re-transcribes from the stored audio when no transcript exists.
    retrySummary: builder.mutation<{success: boolean; message: string}, number>(
      {
        query: chatId => ({
          url: API_ROUTES.CHATS.RETRY_SUMMARY(chatId),
          method: API_METHODS.POST,
        }),
      },
    ),
  }),
});

export const {
  useLazyGetCallSummaryQuery,
  useUpdateCallSummaryMutation,
  useLazyExportCallSummaryQuery,
  useUpdateCallInfoMutation,
  useEnhanceCallSummaryMutation,
  useGetTagsMutation,
  useAddSummaryFeedbackMutation,
  useRetrySummaryMutation,
} = callSummaryApi;
