import { ApiEndpoints, HttpMethod, TAG_TYPES } from "@constants";
import type {
  TemplateAnswers,
  TemplateCatalogue,
  TemplateInstallResult,
  TemplateOrigin,
} from "@types";

import { baseAPI } from "./baseApi";

import type { BotDraftView } from "../pages/Onboarding/types";

/**
 * Use-case templates (Agents v2, T1): the cards, installing one in setup or from Tools, and where
 * an assistant came from. Installing changes the assistant's lists, so it refetches them, its home
 * and its checkup.
 */
const tag = (id: string, part: string) => ({ type: TAG_TYPES.CHATBOT_DETAIL, id: `${id}:${part}` });

export const templatesApi = baseAPI.injectEndpoints({
  endpoints: builder => ({
    /** Before a setup starts: no assistant yet, so nothing is suggested. */
    getTemplateCatalogue: builder.query<TemplateCatalogue, void>({
      query: () => ({ url: ApiEndpoints.ASSISTANT_TEMPLATES, method: HttpMethod.GET }),
    }),

    /** For an assistant: the suggested template first, and the lists it already has. */
    getAssistantTemplates: builder.query<TemplateCatalogue, string>({
      query: id => ({ url: ApiEndpoints.CHATBOTS.TEMPLATES(id), method: HttpMethod.GET }),
      providesTags: (_r, _e, id) => [tag(id, "templates")],
    }),

    getTemplateOrigin: builder.query<TemplateOrigin, string>({
      query: id => ({ url: ApiEndpoints.CHATBOTS.TEMPLATE_ORIGIN(id), method: HttpMethod.GET }),
      providesTags: (_r, _e, id) => [tag(id, "templates"), tag(id, "lists")],
    }),

    /** Tools → Add from a template. */
    installTemplate: builder.mutation<
      TemplateInstallResult,
      { id: string; template: string; answers: TemplateAnswers }
    >({
      query: ({ id, template, answers }) => ({
        url: ApiEndpoints.CHATBOTS.TEMPLATE(id, template),
        method: HttpMethod.POST,
        body: { answers },
      }),
      invalidatesTags: (r, _e, { id }) =>
        r
          ? [
              tag(id, "lists"),
              tag(id, "templates"),
              { type: TAG_TYPES.CHATBOT_DETAIL, id },
              { type: TAG_TYPES.CHATBOTS, id },
            ]
          : [],
    }),

    /** Setup: "Start from a template" after the website was read. */
    applyDraftTemplate: builder.mutation<
      { result: TemplateInstallResult; draft: BotDraftView },
      { draftId: string; template: string; answers: TemplateAnswers }
    >({
      query: ({ draftId, template, answers }) => ({
        url: ApiEndpoints.BOT_DRAFTS.TEMPLATE(draftId),
        method: HttpMethod.POST,
        body: { template, answers },
      }),
      invalidatesTags: r => (r ? [TAG_TYPES.BOT_DRAFT] : []),
    }),
  }),
});

export const {
  useGetTemplateCatalogueQuery,
  useGetAssistantTemplatesQuery,
  useGetTemplateOriginQuery,
  useInstallTemplateMutation,
  useApplyDraftTemplateMutation,
} = templatesApi;
