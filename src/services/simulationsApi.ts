import {API_METHODS, API_ROUTES, SortOrder} from '@/constants';
import {LogItem} from '@/screens/CallLog/types';
import {
  EndScenarioSessionResponse,
  FeedbackRequest,
  FeedbackResponse,
  RoomListResponse,
  Scenario,
  ScenarioSessionStartResponse,
  SimulationCredits,
  SimulationPath,
  SimulationPathDetails,
  SimulationPathsResponse,
  SimulationSummaryData,
  UpNextSimulation,
} from '@/types';

import {api} from './api';

export const simulationsApi = api.injectEndpoints({
  endpoints: builder => ({
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
    }),

    getScenarioById: builder.query<Scenario, {id: string}>({
      query: ({id}) => ({
        url: API_ROUTES.LEARN.SCENARIO_BY_ID(id),
        method: API_METHODS.GET,
      }),
    }),

    addSimulationFeedback: builder.mutation<FeedbackResponse, FeedbackRequest>({
      query: ({scenarioSessionId, rating, comment}) => ({
        url: API_ROUTES.LEARN.SCENARIO_SESSION_FEEDBACK(scenarioSessionId),
        method: API_METHODS.POST,
        body: {
          rating: Number(rating),
          feedback: comment,
        },
      }),
    }),

    getSimulationDetails: builder.query<SimulationSummaryData, {id: string}>({
      query: ({id}) => ({
        url: API_ROUTES.LEARN.SIMULATION_DETAILS(id),
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
      {scenarioId: number; scenarioPathSessionItemId?: string}
    >({
      query: ({scenarioId, scenarioPathSessionItemId}) => ({
        url: API_ROUTES.LEARN.SCENARIO_SESSION_START,
        method: API_METHODS.POST,
        body: {
          scenarioId,
          ...(scenarioPathSessionItemId && {scenarioPathSessionItemId}),
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
      }),
      invalidatesTags: [
        'SimulationCredits',
        'SimulationPaths',
        'SimulationPathDetails',
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
      UpNextSimulation | null,
      {scenarioSessionId: string}
    >({
      query: ({scenarioSessionId}) => ({
        url: API_ROUTES.LEARN.UPCOMING_SCENARIO(scenarioSessionId),
        method: API_METHODS.GET,
      }),
    }),
  }),
});

export const {
  useListRoomsQuery,
  useGetScenariosQuery,
  useAddSimulationFeedbackMutation,
  useGetSimulationLogsQuery,
  useLazyGetSimulationLogsQuery,
  useStartScenarioSessionMutation,
  useEndScenarioSessionMutation,
  useLazyGetSimulationDetailsQuery,
  useLazyGetSimulationCreditsQuery,
  useGetSimulationPathsQuery,
  useGetSimulationPathDetailsQuery,
  useCreatePathSessionMutation,
  useLazyGetUpcomingScenarioQuery,
} = simulationsApi;
