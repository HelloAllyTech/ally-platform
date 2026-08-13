import {API_METHODS, API_ROUTES, SortOrder} from '@/constants';
import {LogItem} from '@/screens/CallLog/types';
import {
  Case,
  CaseDetails,
  CasesResponse,
  EndScenarioSessionResponse,
  EventChecklistResponse,
  FeedbackRequest,
  FeedbackResponse,
  LanguageOption,
  RoomListResponse,
  Scenario,
  ScenarioSessionStartResponse,
  SimulationCredits,
  SimulationPath,
  SimulationPathDetails,
  SimulationPathsResponse,
  SimulationSummaryData,
  UpcomingScenarioResponse,
} from '@/types';

import {api} from './api';

export type {LanguageOption};

export interface AvailableLanguagesParams {
  active?: boolean;
  hasVoices?: boolean;
}

export const simulationsApi = api.injectEndpoints({
  endpoints: builder => ({
    /**
     * Get all available languages for scenarios
     * @param {AvailableLanguagesParams} params - Optional query parameters (active and/or hasVoices)
     * @returns {Promise<LanguageOption[]>} List of available languages with their codes and labels
     */
    getAvailableLanguages: builder.query<
      LanguageOption[],
      AvailableLanguagesParams
    >({
      query: (params = {}) => ({
        url: API_ROUTES.LEARN.GET_AVAILABLE_LANGUAGES,
        method: API_METHODS.GET,
        params,
      }),
    }),

    listRooms: builder.query<RoomListResponse, void>({
      query: () => ({
        url: API_ROUTES.LEARN.ROOMS,
        method: API_METHODS.GET,
      }),
    }),

    getScenarios: builder.query<Scenario[], void>({
      query: () => ({
        url: API_ROUTES.LEARN.SCENARIOS,
        method: API_METHODS.GET,
      }),
      transformResponse: (response: {data: Scenario[]}) => response.data,
    }),

    getScenarioById: builder.query<Scenario, {id: string}>({
      query: ({id}) => ({
        url: API_ROUTES.LEARN.SCENARIO_BY_ID(id),
        method: API_METHODS.GET,
      }),
    }),

    addSimulationFeedback: builder.mutation<FeedbackResponse, FeedbackRequest>({
      query: ({scenarioSessionId, rating, comment, tags}) => ({
        url: API_ROUTES.LEARN.SCENARIO_SESSION_FEEDBACK(scenarioSessionId),
        method: API_METHODS.POST,
        body: {
          rating: Number(rating),
          feedback: comment,
          ...(tags && tags.length > 0 ? {tags} : {}),
        },
      }),
    }),

    getSimulationDetails: builder.query<SimulationSummaryData, {id: string}>({
      query: ({id}) => ({
        url: API_ROUTES.LEARN.SIMULATION_DETAILS(id),
        params: {enableRecommendations: true},
      }),
    }),

    getSimulationLogs: builder.query<
      {data: LogItem[]},
      {limit: number; offset: number}
    >({
      query: ({limit, offset}) => ({
        url: API_ROUTES.LEARN.SIMULATION_LOGS,
        params: {limit, offset, sortBy: 'createdAt', order: SortOrder.DESC},
      }),
    }),

    startScenarioSession: builder.mutation<
      ScenarioSessionStartResponse,
      {
        scenarioId: number;
        scenarioPathSessionItemId?: string;
        caseSessionItemId?: string;
        trackItemProgressId?: string;
        languageId?: number;
      }
    >({
      query: ({
        scenarioId,
        scenarioPathSessionItemId,
        caseSessionItemId,
        trackItemProgressId,
        languageId,
      }) => ({
        url: API_ROUTES.LEARN.SCENARIO_SESSION_START,
        method: API_METHODS.POST,
        body: {
          scenarioId,
          ...(scenarioPathSessionItemId && {scenarioPathSessionItemId}),
          ...(caseSessionItemId && {caseSessionItemId}),
          ...(trackItemProgressId && {trackItemProgressId}),
          ...(languageId && {languageId}),
        },
      }),
    }),

    endScenarioSession: builder.mutation<
      EndScenarioSessionResponse,
      {scenarioSessionId: string}
    >({
      query: ({scenarioSessionId}) => ({
        url: API_ROUTES.LEARN.END_SCENARIO_SESSION(scenarioSessionId),
        method: API_METHODS.POST,
        body: {enableRecommendations: true},
      }),
      invalidatesTags: [
        'SimulationCredits',
        'SimulationPaths',
        'SimulationPathDetails',
        'Cases',
        'CaseDetails',
      ],
    }),

    getSimulationCredits: builder.query<SimulationCredits, void>({
      query: () => ({
        url: API_ROUTES.LEARN.SIMULATION_CREDITS,
        method: API_METHODS.GET,
      }),
      providesTags: ['SimulationCredits'],
    }),

    getSimulationPaths: builder.query<SimulationPath[], void>({
      query: () => ({
        url: API_ROUTES.LEARN.SCENARIO_PATHS,
        method: API_METHODS.GET,
      }),
      transformResponse: (response: SimulationPathsResponse) => response.data,
      providesTags: ['SimulationPaths'],
    }),

    getSimulationPathDetails: builder.query<
      SimulationPathDetails,
      {pathId: string}
    >({
      query: ({pathId}) => ({
        url: API_ROUTES.LEARN.SIMULATION_PATH_DETAILS(pathId),
        method: API_METHODS.GET,
      }),
      transformResponse: (response: SimulationPathDetails) => ({
        ...response,
        scenarios: [...response.scenarios].sort((a, b) => a.order - b.order),
      }),
      providesTags: ['SimulationPathDetails'],
    }),

    createPathSession: builder.mutation<
      {scenarioPathSessionItemId: string},
      {pathId: string}
    >({
      query: ({pathId}) => ({
        url: API_ROUTES.LEARN.CREATE_PATH_SESSION(pathId),
        method: API_METHODS.POST,
      }),
      invalidatesTags: ['SimulationPathDetails', 'SimulationPaths'],
    }),

    getUpcomingScenario: builder.query<
      UpcomingScenarioResponse | null,
      {scenarioSessionId: string}
    >({
      query: ({scenarioSessionId}) => ({
        url: API_ROUTES.LEARN.UPCOMING_PATH_SCENARIO(scenarioSessionId),
        method: API_METHODS.GET,
      }),
    }),

    getScenarioSessionByPathItem: builder.query<
      {
        id: string;
      },
      {pathSessionItemId: string}
    >({
      query: ({pathSessionItemId}) => ({
        url: API_ROUTES.LEARN.SCENARIO_SESSION_BY_PATH_ITEM(pathSessionItemId),
        method: API_METHODS.GET,
      }),
    }),

    getCases: builder.query<Case[], void>({
      query: () => ({
        url: API_ROUTES.LEARN.CASES,
        method: API_METHODS.GET,
      }),
      transformResponse: (response: CasesResponse) => response.data,
      providesTags: ['Cases'],
    }),

    getCaseDetails: builder.query<CaseDetails, {caseId: string}>({
      query: ({caseId}) => ({
        url: API_ROUTES.LEARN.CASE_DETAILS(caseId),
        method: API_METHODS.GET,
      }),
      transformResponse: (response: CaseDetails) => ({
        ...response,
        scenarios: [...response.scenarios].sort((a, b) => a.order - b.order),
      }),
      providesTags: ['CaseDetails'],
    }),

    createCaseSession: builder.mutation<
      {caseSessionItemId: string},
      {caseId: string}
    >({
      query: ({caseId}) => ({
        url: API_ROUTES.LEARN.CREATE_CASE_SESSION(caseId),
        method: API_METHODS.POST,
      }),
      invalidatesTags: ['CaseDetails', 'Cases'],
    }),

    getUpcomingCaseScenario: builder.query<
      UpcomingScenarioResponse | null,
      {scenarioSessionId: string}
    >({
      query: ({scenarioSessionId}) => ({
        url: API_ROUTES.LEARN.UPCOMING_CASE_SCENARIO(scenarioSessionId),
        method: API_METHODS.GET,
      }),
    }),

    getScenarioSessionByCaseItem: builder.query<
      {id: string},
      {caseSessionItemId: string}
    >({
      query: ({caseSessionItemId}) => ({
        url: API_ROUTES.LEARN.SCENARIO_SESSION_BY_CASE_ITEM(caseSessionItemId),
        method: API_METHODS.GET,
      }),
    }),

    getEventChecklist: builder.query<
      EventChecklistResponse,
      {scenarioSessionId: string}
    >({
      query: ({scenarioSessionId}) => ({
        url: API_ROUTES.LEARN.EVENT_CHECKLIST(scenarioSessionId),
        method: API_METHODS.GET,
      }),
    }),
  }),
});

export const {
  useGetAvailableLanguagesQuery,
  useListRoomsQuery,
  useGetScenariosQuery,
  useGetScenarioByIdQuery,
  useAddSimulationFeedbackMutation,
  useGetSimulationLogsQuery,
  useLazyGetSimulationLogsQuery,
  useStartScenarioSessionMutation,
  useEndScenarioSessionMutation,
  useGetSimulationDetailsQuery,
  useLazyGetSimulationDetailsQuery,
  useLazyGetSimulationCreditsQuery,
  useGetSimulationPathsQuery,
  useGetSimulationPathDetailsQuery,
  useCreatePathSessionMutation,
  useGetUpcomingScenarioQuery,
  useLazyGetUpcomingScenarioQuery,
  useLazyGetScenarioSessionByPathItemQuery,
  useGetCasesQuery,
  useGetCaseDetailsQuery,
  useCreateCaseSessionMutation,
  useGetUpcomingCaseScenarioQuery,
  useLazyGetUpcomingCaseScenarioQuery,
  useLazyGetScenarioSessionByCaseItemQuery,
  useGetEventChecklistQuery,
  useLazyGetEventChecklistQuery,
} = simulationsApi;
