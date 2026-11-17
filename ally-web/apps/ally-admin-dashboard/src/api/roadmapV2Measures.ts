import { ApiEndpoints, HttpMethod } from "@constants";
import type { RoadmapMetrics, RoadmapMetricsQuery } from "@types";

import { baseAPI } from "./baseApi";

/**
 * Roadmap v2 P8: the Owner's Measures. 404 while `roadmap_v2` is off, 403 for anyone but an
 * Owner. Read-only and computed on each call, so a minute of cache is plenty.
 */
export const roadmapV2MeasuresAPI = baseAPI.injectEndpoints({
  endpoints: builder => ({
    getRoadmapMetrics: builder.query<RoadmapMetrics, RoadmapMetricsQuery>({
      query: ({ from, to }) => ({
        url: ApiEndpoints.ROADMAP_V2_MEASURES.METRICS,
        method: HttpMethod.GET,
        params: { from, to },
      }),
      keepUnusedDataFor: 60,
    }),
  }),
});

export const { useGetRoadmapMetricsQuery } = roadmapV2MeasuresAPI;
