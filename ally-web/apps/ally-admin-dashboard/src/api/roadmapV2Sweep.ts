import { ApiEndpoints, HttpMethod, TAG_TYPES } from "@constants";
import type { RoadmapSweepResponse } from "@types";

import { baseAPI } from "./baseApi";

const sweepTag = { type: TAG_TYPES.ROADMAP_V2_ITEMS, id: "SWEEP" } as const;
const listTag = { type: TAG_TYPES.ROADMAP_V2_ITEMS, id: "LIST" } as const;

/**
 * The Owner's old-and-quiet sweep of To do (idea-to-plan audit rec 9). The sweep only finds ideas;
 * declining goes through the existing bulk review, and Keep stops an idea being offered again.
 * 403 for anyone but an Owner.
 */
export const roadmapV2SweepAPI = baseAPI.injectEndpoints({
  endpoints: builder => ({
    getRoadmapSweep: builder.query<RoadmapSweepResponse, void>({
      query: () => ({ url: ApiEndpoints.ROADMAP_V2_SWEEP.LIST, method: HttpMethod.GET }),
      // Any change to the list (a decline, a review) can change who the sweep finds.
      providesTags: [sweepTag, listTag],
    }),
    keepRoadmapSweepIdeas: builder.mutation<{ kept: number }, string[]>({
      query: codes => ({
        url: ApiEndpoints.ROADMAP_V2_SWEEP.KEEP,
        method: HttpMethod.POST,
        body: { codes },
      }),
      invalidatesTags: [sweepTag],
    }),
  }),
});

export const { useGetRoadmapSweepQuery, useKeepRoadmapSweepIdeasMutation } = roadmapV2SweepAPI;
