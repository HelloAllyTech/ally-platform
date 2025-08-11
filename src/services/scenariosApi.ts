import type {ScenariosResponse} from '@/types/scenarios';

import {learnApi} from './api';

export const scenariosApi = learnApi.injectEndpoints({
  endpoints: builder => ({
    getScenarios: builder.query<ScenariosResponse, void>({
      query: () => '/scenarios',
    }),
  }),
});

export const {useGetScenariosQuery} = scenariosApi;
