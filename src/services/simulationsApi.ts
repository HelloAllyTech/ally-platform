import {API_METHODS, API_ROUTES} from '@/constants';
import {LogItem} from '@/screens/CallLog/types';
import {
  EndScenarioSessionResponse,
  FeedbackRequest,
  FeedbackResponse,
  RoomDeletionResponse,
  RoomListResponse,
  Scenario,
  ScenarioSessionStartResponse,
  SimulationSummaryData,
} from '@/types';

import {api} from './api';

export const simulationsApi = api.injectEndpoints({
  endpoints: builder => ({
    listRooms: builder.query<RoomListResponse, void>({
      query: () => ({
        url: API_ROUTES.ROOMS,
        method: API_METHODS.GET,
      }),
    }),

    deleteRoom: builder.mutation<RoomDeletionResponse, string>({
      query: roomId => ({
        url: `${API_ROUTES.ROOMS}/${roomId}`,
        method: API_METHODS.DELETE,
      }),
    }),

    getScenarios: builder.query<Scenario[], void>({
      query: () => ({
        url: API_ROUTES.SCENARIOS,
        method: API_METHODS.GET,
      }),
    }),

    getScenarioById: builder.query<Scenario, {id: string | number}>({
      query: ({id}) => ({
        url: `${API_ROUTES.SCENARIOS}/${id}`,
        method: API_METHODS.GET,
      }),
    }),

    addSimulationFeedback: builder.mutation<FeedbackResponse, FeedbackRequest>({
      query: ({scenarioSessionId, rating, comment}) => ({
        url: `/learn/scenario-session/${scenarioSessionId}/feedback`,
        method: API_METHODS.POST,
        body: {
          rating: Number(rating),
          feedback: comment,
        },
      }),
    }),

    getSimulationDetails: builder.query<
      SimulationSummaryData,
      {id: string | number}
    >({
      query: ({id}) => ({url: `${API_ROUTES.SIMULATION_DETAILS}/${id}`}),
    }),

    getSimulationLogs: builder.query<
      LogItem[],
      {limit: number; offset: number}
    >({
      query: ({limit, offset}) => ({
        url: API_ROUTES.SIMULATION_LOGS,
        params: {limit, offset, sortBy: 'createdAt', order: 'DESC'},
      }),
    }),

    startScenarioSession: builder.mutation<
      ScenarioSessionStartResponse,
      {scenarioId: number}
    >({
      query: ({scenarioId}) => ({
        url: API_ROUTES.SCENARIO_SESSION_START,
        method: API_METHODS.POST,
        body: {scenarioId},
      }),
    }),

    endScenarioSession: builder.mutation<
      EndScenarioSessionResponse,
      {scenarioSessionId: string}
    >({
      query: ({scenarioSessionId}) => ({
        url: `${API_ROUTES.END_SCENARIO_SESSION}/${scenarioSessionId}/end`,
        method: API_METHODS.POST,
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
} = simulationsApi;
