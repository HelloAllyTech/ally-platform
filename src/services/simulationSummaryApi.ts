import {API_METHODS, API_ROUTES} from '@/constants';
import {SimulationSkillsResponse} from '@/types/simulationSummary';

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
  }),
});

export const {useGetSimulationSkillsQuery} = simulationSummaryApi;
