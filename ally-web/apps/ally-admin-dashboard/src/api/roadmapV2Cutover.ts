import { ApiEndpoints, HttpMethod, TAG_TYPES } from "@constants";
import type { RoadmapCutoverPreview, RoadmapCutoverRequest, RoadmapCutoverResult } from "@types";

import { baseAPI } from "./baseApi";

/**
 * Switch on Roadmap (Roadmap v2 P6). Unlike the rest of `/v1/roadmap/*`, both routes answer while
 * `roadmap_v2` is off; they answer 403 to anyone who isn't a Roadmap Owner.
 */
export const roadmapV2CutoverAPI = baseAPI.injectEndpoints({
  endpoints: builder => ({
    /** Refetched when the flag or anyone's Roadmap role changes. */
    getRoadmapCutoverPreview: builder.query<RoadmapCutoverPreview, void>({
      query: () => ({ url: ApiEndpoints.ROADMAP_V2_CUTOVER.PREVIEW, method: HttpMethod.GET }),
      providesTags: [TAG_TYPES.BUILDER_SETTINGS, { type: TAG_TYPES.ROADMAP_V2_ROLES, id: "LIST" }],
    }),

    /** Switches the flag on: the caller's role, the settings and every Roadmap list refetch. */
    runRoadmapCutover: builder.mutation<RoadmapCutoverResult, RoadmapCutoverRequest>({
      query: body => ({ url: ApiEndpoints.ROADMAP_V2_CUTOVER.RUN, method: HttpMethod.POST, body }),
      invalidatesTags: [
        TAG_TYPES.BUILDER_SETTINGS,
        TAG_TYPES.ROADMAP_V2_ROLE,
        { type: TAG_TYPES.ROADMAP_V2_ROLES, id: "LIST" },
        { type: TAG_TYPES.ROADMAP_V2_ITEMS, id: "LIST" },
      ],
    }),
  }),
});

export const { useGetRoadmapCutoverPreviewQuery, useRunRoadmapCutoverMutation } =
  roadmapV2CutoverAPI;
