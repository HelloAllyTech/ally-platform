import { ApiEndpoints, HttpMethod, TAG_TYPES } from "@constants";
import { GuidanceMetrics, GuidanceMetricsParams } from "@types";

import { baseAPI } from "./baseApi";

/** Analytics › Debriefs › Guidance. `url` is read inside the query: suites mock `@constants`. */
export const debriefGuidanceMetricsAPI = baseAPI.injectEndpoints({
  endpoints: builder => ({
    getDebriefGuidanceMetrics: builder.query<GuidanceMetrics, GuidanceMetricsParams>({
      query: ({ days, mode }) => ({
        url: ApiEndpoints.DEBRIEF_CONSOLE.GUIDANCE_METRICS,
        method: HttpMethod.GET,
        params: { days, mode },
      }),
      providesTags: [TAG_TYPES.DEBRIEF_CONSOLE],
    }),
  }),
});

export const { useGetDebriefGuidanceMetricsQuery } = debriefGuidanceMetricsAPI;
