import {API_METHODS, API_ROUTES} from '@/constants';

import {api} from './api';

export interface ReflectionPrompt {
  id: string;
  prompt: string;
  response?: string;
}

export interface ReflectionPromptsResponse {
  reflectionPrompts: ReflectionPrompt[];
}

export interface ReflectionPromptRequest {
  promptId: string;
  response: string;
}

export const reflectionsApi = api.injectEndpoints({
  endpoints: builder => ({
    getReflectionPrompts: builder.query<
      ReflectionPromptsResponse,
      {scenarioSessionId: string}
    >({
      query: ({scenarioSessionId}) => ({
        url: API_ROUTES.LEARN.REFLECTION_PROMPTS(scenarioSessionId),
        method: API_METHODS.GET,
      }),
    }),
    updateReflectionPrompt: builder.mutation<
      void,
      {scenarioSessionId: string; body: ReflectionPromptRequest}
    >({
      query: ({scenarioSessionId, body}) => ({
        url: API_ROUTES.LEARN.REFLECTION_PROMPTS(scenarioSessionId),
        method: API_METHODS.PATCH,
        body,
      }),
    }),
  }),
});

export const {useGetReflectionPromptsQuery, useUpdateReflectionPromptMutation} =
  reflectionsApi;
