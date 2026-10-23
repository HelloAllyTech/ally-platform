import {API_METHODS, API_ROUTES} from '@/constants';

import {api} from './api';
import {
  CustomFieldDefinition,
  CustomFieldValue,
  UpsertCustomFieldValuesInput,
} from './customFieldsApi.types';

// Re-export the shared custom-field types/enums so existing
// `@/services/customFieldsApi` importers keep working. New lightweight
// consumers should import from './customFieldsApi.types' directly to avoid
// pulling in the `api` (and i18n) chain.
export * from './customFieldsApi.types';

export const customFieldsApi = api.injectEndpoints({
  overrideExisting: true,
  endpoints: builder => ({
    getCustomFieldDefinitions: builder.query<CustomFieldDefinition[], void>({
      query: () => API_ROUTES.CUSTOM_FIELDS.DEFINITIONS,
    }),

    getCustomFieldValues: builder.query<CustomFieldValue[], number>({
      query: chatId => API_ROUTES.CUSTOM_FIELDS.VALUES(chatId),
    }),

    upsertCustomFieldValues: builder.mutation<
      {success: boolean},
      {chatId: number} & UpsertCustomFieldValuesInput
    >({
      query: ({chatId, values}) => ({
        url: API_ROUTES.CUSTOM_FIELDS.VALUES(chatId),
        method: API_METHODS.PUT,
        body: {values},
      }),
    }),

    getCustomFieldsEnabled: builder.query<boolean, void>({
      query: () => API_ROUTES.SETTINGS.CUSTOM_FIELDS_ENABLED,
    }),
  }),
});

export const {
  useGetCustomFieldDefinitionsQuery,
  useGetCustomFieldValuesQuery,
  useUpsertCustomFieldValuesMutation,
  useGetCustomFieldsEnabledQuery,
} = customFieldsApi;
