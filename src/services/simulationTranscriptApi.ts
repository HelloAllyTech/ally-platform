import {API_METHODS, API_ROUTES} from '@/constants';

import {api} from './api';

export interface SimulationMessageTag {
  label: string;
  category: 'POSITIVE' | 'NEGATIVE';
}

export interface SimulationMessage {
  id: number;
  scenarioSessionId: number;
  content: string;
  context?: string | null;
  createdAt: string;
  feedback?: string | null;
  senderId: number;
  startSeconds?: number | null;
  tags?: SimulationMessageTag[];
}

type SimulationMessagesResponse = {
  messages: SimulationMessage[];
  count: number;
};

interface SimulationMessagesParams {
  scenarioSessionId: string;
  limit?: number;
  offset?: number;
  sortBy?: string;
  sortOrder?: string;
}

export interface SimulationSessionRecordingParams {
  scenarioSessionId: string;
}

export interface SimulationSessionRecordingResponse {
  presignedUrl: string;
}

export const simulationTranscriptApi = api.injectEndpoints({
  endpoints: builder => ({
    getSimulationSessionRecording: builder.query<
      SimulationSessionRecordingResponse,
      SimulationSessionRecordingParams
    >({
      query: ({scenarioSessionId}) => ({
        url: API_ROUTES.LEARN.SCENARIO_SESSION_RECORDING(scenarioSessionId),
        method: API_METHODS.GET,
      }),
    }),
    getSimulationMessages: builder.query<
      SimulationMessagesResponse,
      SimulationMessagesParams
    >({
      query: ({scenarioSessionId, limit, offset, sortBy, sortOrder}) => ({
        url: API_ROUTES.LEARN.SIMULATION_MESSAGES(scenarioSessionId),
        method: API_METHODS.GET,
        params: {
          limit,
          offset,
          sortBy,
          sortOrder,
          includeTags: true,
        },
      }),
    }),
  }),
});

export const {
  useLazyGetSimulationMessagesQuery,
  useLazyGetSimulationSessionRecordingQuery,
} = simulationTranscriptApi;
