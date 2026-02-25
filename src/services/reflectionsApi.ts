import {API_METHODS, API_ROUTES} from '@/constants';

import {api} from './api';

export interface ReflectionPrompt {
  id: string;
  scenarioSessionId: string;
  promptId: string;
  prompt: string;
  response?: string;
  tenantId?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ReflectionPromptsResponse {
  reflectionPrompts: ReflectionPrompt[];
}

export interface ReflectionPromptRequest {
  promptId: string;
  response: string;
}

export interface UpdateReflectionPromptArgs {
  scenarioSessionId: string;
  reflectionPromptId: string;
  body: ReflectionPromptRequest;
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
      providesTags: ['ReflectionPrompts'],
    }),
    updateReflectionPrompt: builder.mutation<
      ReflectionPrompt,
      UpdateReflectionPromptArgs
    >({
      query: ({scenarioSessionId, reflectionPromptId, body}) => ({
        url: API_ROUTES.LEARN.REFLECTION_PROMPT_BY_ID(
          scenarioSessionId,
          reflectionPromptId,
        ),
        method: API_METHODS.PATCH,
        body,
      }),
      invalidatesTags: ['ReflectionPrompts'],
    }),
  }),
});

export const {useGetReflectionPromptsQuery, useUpdateReflectionPromptMutation} =
  reflectionsApi;
