import { HttpMethod, TAG_TYPES } from "@constants";

import { baseAPI } from "./baseApi";

/** A site the website widget has loaded on (ally-be `WidgetSitesService`, stage 7). */
export interface WidgetSiteRow {
  host: string;
  firstSeen: string;
  lastSeen: string;
  /** Approximate: written at most once an hour per site. */
  loadCount: number;
}

export type DomainStepState = "ok" | "missing" | "wrong" | "error";

export interface DomainStepResult {
  state: DomainStepState;
  /** What DNS answered. */
  found: string[];
}

/** An owner's own web address for the bot page (ally-be `BotPageDomainService`, stage 7). */
export interface BotPageDomain {
  id: string;
  host: string;
  status: "pending" | "verified" | "failed";
  records: { type: "CNAME" | "TXT"; name: string; value: string }[];
  lastCheck: { cname: DomainStepResult; txt: DomainStepResult } | null;
  checkedAt: string | null;
  verifiedAt: string | null;
  url: string;
}

// The stage 7 routes. Kept here rather than in the shared ApiEndpoints, since only Channels calls them.
const CHANNEL_ROUTES = {
  widgetSites: (id: string) => `/v1/chatbots/${id}/widget-sites`,
  domains: (id: string) => `/v1/chatbots/${id}/page/domains`,
  domain: (id: string, domainId: string) => `/v1/chatbots/${id}/page/domains/${domainId}`,
};

const domainsTag = (id: string) => [{ type: TAG_TYPES.CHATBOT_DETAIL, id: `${id}:domains` }];

/** Channels (stage 7): where the widget has been, and the page's own web address. */
export const channelsApi = baseAPI.injectEndpoints({
  endpoints: builder => ({
    getWidgetSites: builder.query<{ sites: WidgetSiteRow[] }, string>({
      query: id => ({ url: CHANNEL_ROUTES.widgetSites(id), method: HttpMethod.GET }),
    }),
    getBotPageDomains: builder.query<{ domains: BotPageDomain[] }, string>({
      query: id => ({ url: CHANNEL_ROUTES.domains(id), method: HttpMethod.GET }),
      providesTags: (_r, _e, id) => domainsTag(id),
    }),
    addBotPageDomain: builder.mutation<BotPageDomain, { id: string; host: string }>({
      query: ({ id, host }) => ({
        url: CHANNEL_ROUTES.domains(id),
        method: HttpMethod.POST,
        body: { host },
      }),
      invalidatesTags: (r, _e, { id }) => (r ? domainsTag(id) : []),
    }),
    checkBotPageDomain: builder.mutation<BotPageDomain, { id: string; domainId: string }>({
      query: ({ id, domainId }) => ({
        url: `${CHANNEL_ROUTES.domain(id, domainId)}/check`,
        method: HttpMethod.POST,
      }),
      invalidatesTags: (r, _e, { id }) => (r ? domainsTag(id) : []),
    }),
    removeBotPageDomain: builder.mutation<void, { id: string; domainId: string }>({
      query: ({ id, domainId }) => ({
        url: CHANNEL_ROUTES.domain(id, domainId),
        method: HttpMethod.DELETE,
      }),
      invalidatesTags: (_r, _e, { id }) => domainsTag(id),
    }),
  }),
});

export const {
  useGetWidgetSitesQuery,
  useGetBotPageDomainsQuery,
  useAddBotPageDomainMutation,
  useCheckBotPageDomainMutation,
  useRemoveBotPageDomainMutation,
} = channelsApi;
