import {API_METHODS, API_ROUTES} from '@/constants';
import {AskAIChatMessage} from '@/screens/SimulationFeedbackScreen/components/AskAI/types';
import {SimulationSkillsResponse} from '@/types';

import {api} from './api';

export const simulationSummaryApi = api.injectEndpoints({
  endpoints: builder => ({
    getSimulationSkills: builder.query<
      SimulationSkillsResponse,
      {scenarioSessionId: string}
    >({
      query: ({scenarioSessionId}) => ({
        url: API_ROUTES.SIMULATION_SUMMARY.GET_SKILLS(scenarioSessionId),
        method: API_METHODS.GET,
      }),
    }),
    getChatHistory: builder.query<AskAIChatMessage[], string>({
      query: (scenarioSessionId: string) => ({
        url: API_ROUTES.LEARN.CHAT_HISTORY(scenarioSessionId),
        method: API_METHODS.GET,
      }),
    }),
  }),
});

export const {useGetSimulationSkillsQuery, useLazyGetChatHistoryQuery} =
  simulationSummaryApi;
