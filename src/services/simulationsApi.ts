import {
  API_METHODS,
  API_ROUTES,
  SortOrder,
  USE_MOCK_SCENARIO_PATHS,
} from '@/constants';
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
  SimulationSummaryData,
} from '@/types';

import {api} from './api';
import {
  getMockPathDetailsById,
  MOCK_SCENARIO_PATHS,
} from './mockScenarioPathsData';

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
      {scenarioId: number}
    >({
      query: ({scenarioId}) => ({
        url: API_ROUTES.LEARN.SCENARIO_SESSION_START,
        method: API_METHODS.POST,
        body: {scenarioId},
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
      invalidatesTags: ['SimulationCredits'],
    }),

    getSimulationCredits: builder.query<SimulationCredits, void>({
      query: () => ({
        url: API_ROUTES.LEARN.SIMULATION_CREDITS,
        method: API_METHODS.GET,
      }),
      providesTags: ['SimulationCredits'],
    }),

    /**
     * Get simulation paths - Placeholder for future API integration
     * Currently uses scenarios data as a temporary solution
     * When the actual API is ready, only the query URL needs to be updated
     */
    getSimulationPaths: builder.query<SimulationPath[], void>({
      queryFn: async (_arg, _queryApi, _extraOptions, fetchWithBQ) => {
        if (USE_MOCK_SCENARIO_PATHS) {
          return {data: MOCK_SCENARIO_PATHS};
        }

        try {
          const result = await fetchWithBQ({
            url: API_ROUTES.LEARN.SCENARIO_PATHS,
            method: API_METHODS.GET,
          });

          if (result.error) {
            return {error: result.error};
          }

          return {data: result.data as SimulationPath[]};
        } catch (error) {
          return {
            error: {
              status: 'CUSTOM_ERROR',
              error: String(error),
            },
          };
        }
      },
    }),

    /**
     * Get simulation path details by ID
     *
     * MOCK IMPLEMENTATION - Reuses scenarios API
     *
     * TODO: When real API is ready, replace with:
     * ```
     * getSimulationPathDetails: builder.query<SimulationPath, {pathId: string}>({
     *   query: ({pathId}) => ({
     *     url: API_ROUTES.LEARN.SIMULATION_PATH_DETAILS(pathId), // Update route
     *     method: API_METHODS.GET,
     *   }),
     * }),
     * ```
     *
     * The API should return SimulationPath with:
     * - Basic path info (id, title, description, coverImageUrl)
     * - Array of simulations with their status (completed, locked, etc.)
     * - Progress stats (completedCount, totalCount)
     */
    getSimulationPathDetails: builder.query<
      SimulationPathDetails,
      {pathId: string}
    >({
      queryFn: async ({pathId}, _queryApi, _extraOptions, fetchWithBQ) => {
        if (USE_MOCK_SCENARIO_PATHS) {
          const mockData = getMockPathDetailsById(pathId);
          if (!mockData) {
            return {
              error: {
                status: 'CUSTOM_ERROR' as const,
                error: 'Path not found',
              },
            };
          }
          // Flatten the data structure and sort scenarios by order
          return {
            data: {
              ...mockData,
              scenarios: [...mockData.scenarios].sort(
                (a, b) => a.order - b.order,
              ),
            },
          };
        }

        try {
          const result = await fetchWithBQ({
            url: API_ROUTES.LEARN.SIMULATION_PATH_DETAILS(pathId),
            method: API_METHODS.GET,
          });

          if (result.error) {
            return {error: result.error};
          }

          const response = result.data as SimulationPathDetails;
          // Flatten the data structure and sort scenarios by order
          return {
            data: {
              ...response,
              scenarios: [...response.scenarios].sort(
                (a, b) => a.order - b.order,
              ),
            },
          };
        } catch (error) {
          return {
            error: {
              status: 'CUSTOM_ERROR',
              error: String(error),
            },
          };
        }
      },
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
} = simulationsApi;
