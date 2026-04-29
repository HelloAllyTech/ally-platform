import {API_METHODS, API_ROUTES} from '@/constants';

import {api} from './api';

export enum CustomFieldType {
  SINGLE_SELECT = 'SINGLE_SELECT',
  MULTI_SELECT = 'MULTI_SELECT',
  DATE = 'DATE',
  TEXT = 'TEXT',
  NUMBER = 'NUMBER',
  BOOLEAN = 'BOOLEAN',
}

export enum CustomFieldEditPermission {
  ADMIN_ONLY = 'ADMIN_ONLY',
  COUNSELLOR_ONLY = 'COUNSELLOR_ONLY',
  BOTH = 'BOTH',
}

export interface CustomFieldOption {
  id: string;
  label: string;
  order: number;
}

export interface CustomFieldDefinition {
  id: string;
  name: string;
  fieldType: CustomFieldType;
  sectionKey: string;
  editPermission: CustomFieldEditPermission;
  options?: CustomFieldOption[];
  showInTable: boolean;
}

export interface CustomFieldValue {
  fieldDefinitionId: string;
  value: string | null;
}

export interface UpsertCustomFieldValuesInput {
  values: {fieldDefinitionId: string; value?: string}[];
}

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
