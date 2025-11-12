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
  SimulationSummaryData,
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
        // TODO: Replace this with actual API call when endpoint is ready
        // Temporary: Use scenarios data to populate paths
        try {
          const result = await fetchWithBQ({
            url: API_ROUTES.LEARN.SCENARIOS,
            method: API_METHODS.GET,
          });

          if (result.error) {
            return {error: result.error};
          }

          // Transform scenarios into path format temporarily
          const scenarios = result.data as Scenario[];
          const mockPaths: SimulationPath[] = scenarios.map(scenario => ({
            id: scenario.id,
            title: scenario.title || 'Untitled Path',
            description: scenario.description,
            coverImageUrl: scenario.coverImageUrl,
            simulations: [
              {
                id: scenario.id,
                title: scenario.title,
                description: scenario.description,
                completed: false,
              },
            ],
            completedCount: 0,
            totalCount: 1,
          }));

          return {data: mockPaths};
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
    getSimulationPathDetails: builder.query<SimulationPath, {pathId: string}>({
      queryFn: async ({pathId}, _queryApi, _extraOptions, fetchWithBQ) => {
        // TODO: Replace this entire queryFn with actual API call (see above)
        // For now, fetch all scenarios and create mock path data
        try {
          const result = await fetchWithBQ({
            url: API_ROUTES.LEARN.SCENARIOS,
            method: API_METHODS.GET,
          });

          if (result.error) {
            return {error: result.error};
          }

          const scenarios = result.data as Scenario[];

          // Mock: Use first 4 scenarios as simulations in path
          // Logic: First is completed, second is next (unlocked), rest are locked
          const pathSimulations = scenarios
            .slice(0, 4)
            .map((scenario, index) => {
              const isCompleted = index === 0; // First one is completed
              // Second one is next (unlocked), rest are locked
              const isLocked = index > 1; // 3rd and 4th are locked

              return {
                id: scenario.id,
                order: index + 1,
                title: scenario.title || 'Untitled Simulation',
                description: scenario.description,
                thumbnailUrl: scenario.coverImageUrl,
                completed: isCompleted,
                locked: isLocked,
              };
            });

          // Create mock path
          const mockPath: SimulationPath = {
            id: pathId,
            title: 'Stress management',
            description:
              'This course provides practical techniques for managing stress. It covers identifying stressors, developing coping mechanisms, and building resilience. Learn to regain control and improve your overall well-being.',
            coverImageUrl: scenarios[0]?.coverImageUrl || null,
            simulations: pathSimulations,
            completedCount: 1,
            totalCount: 4,
          };

          return {data: mockPath};
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
