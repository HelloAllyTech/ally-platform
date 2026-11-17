import { ApiEndpoints, HttpMethod, TAG_TYPES } from "@constants";
import type {
  RoadmapBuildBrief,
  RoadmapGrantableRole,
  RoadmapItemDetail,
  RoadmapPreferences,
  RoadmapReleasePlan,
  RoadmapReleaseResult,
  RoadmapReleaseService,
  RoadmapResumeResult,
  RoadmapRoleEntry,
  RoadmapV2SettingsPatch,
} from "@types";

import { baseAPI } from "./baseApi";

const itemTag = (code: string) => ({ type: TAG_TYPES.ROADMAP_V2_ITEMS, id: code.toUpperCase() });

/**
 * Roadmap v2's P4 routes (build brief, Brief sent to Claude Code, the Roadmap role radio, the
 * weekly digest preference) and P5's release policy (the release plan, Release, Resume). Every
 * route answers 404 while `roadmap_v2` is off; who may call each is decided by the server.
 */
export const roadmapV2OpsAPI = baseAPI.injectEndpoints({
  endpoints: builder => ({
    /** Fetched on demand (Preview, Copy, Download, Open in Claude Code), never on page load. */
    getRoadmapBrief: builder.query<RoadmapBuildBrief, string>({
      query: code => ({
        url: ApiEndpoints.ROADMAP_V2_OPS.ITEM_BRIEF(code),
        method: HttpMethod.GET,
      }),
      keepUnusedDataFor: 60,
    }),

    /** "Brief sent to Claude Code": the idea answers with its new detail. */
    recordRoadmapExternalBuild: builder.mutation<RoadmapItemDetail, string>({
      query: code => ({
        url: ApiEndpoints.ROADMAP_V2_OPS.ITEM_EXTERNAL_BUILD(code),
        method: HttpMethod.POST,
        body: { tool: "claude_code" },
      }),
      invalidatesTags: (_result, _error, code) => [
        itemTag(code),
        { type: TAG_TYPES.ROADMAP_V2_ITEMS, id: "LIST" },
      ],
    }),

    listRoadmapRoles: builder.query<{ users: RoadmapRoleEntry[] }, void>({
      query: () => ({ url: ApiEndpoints.ROADMAP_V2_OPS.ROLES, method: HttpMethod.GET }),
      providesTags: [{ type: TAG_TYPES.ROADMAP_V2_ROLES, id: "LIST" }],
    }),

    /** 403 unless the caller is an Owner; 404 while the flag is off or for a non platform admin. */
    getRoadmapRoleFor: builder.query<RoadmapRoleEntry, number>({
      query: userId => ({ url: ApiEndpoints.ROADMAP_V2_OPS.ROLE(userId), method: HttpMethod.GET }),
      providesTags: (_result, _error, userId) => [{ type: TAG_TYPES.ROADMAP_V2_ROLES, id: userId }],
    }),

    /** Writes the three toggles together; the user's own toggle list refetches. */
    setRoadmapRoleFor: builder.mutation<
      RoadmapRoleEntry,
      { userId: number; role: RoadmapGrantableRole }
    >({
      query: ({ userId, role }) => ({
        url: ApiEndpoints.ROADMAP_V2_OPS.ROLE(userId),
        method: HttpMethod.PUT,
        body: { role },
      }),
      invalidatesTags: (_result, _error, { userId }) => [
        { type: TAG_TYPES.ROADMAP_V2_ROLES, id: userId },
        { type: TAG_TYPES.ROADMAP_V2_ROLES, id: "LIST" },
        TAG_TYPES.USER_FEATURE_TOGGLES,
      ],
    }),

    getRoadmapPreferences: builder.query<RoadmapPreferences, void>({
      query: () => ({ url: ApiEndpoints.ROADMAP_V2_OPS.MY_PREFERENCES, method: HttpMethod.GET }),
      providesTags: [TAG_TYPES.ROADMAP_V2_PREFERENCES],
    }),

    setRoadmapPreferences: builder.mutation<RoadmapPreferences, Partial<RoadmapPreferences>>({
      query: body => ({
        url: ApiEndpoints.ROADMAP_V2_OPS.MY_PREFERENCES,
        method: HttpMethod.PUT,
        body,
      }),
      async onQueryStarted(body, { dispatch, queryFulfilled }) {
        const patch = dispatch(
          roadmapV2OpsAPI.util.updateQueryData("getRoadmapPreferences", undefined, draft => {
            Object.assign(draft, body);
          }),
        );
        try {
          await queryFulfilled;
        } catch {
          patch.undo();
        }
      },
    }),

    /** Reads GitHub: fetched when the release dialog opens, not kept for long. */
    getRoadmapReleasePlan: builder.query<RoadmapReleasePlan, RoadmapReleaseService>({
      query: service => ({
        url: ApiEndpoints.ROADMAP_V2_OPS.RELEASE_PLAN,
        method: HttpMethod.GET,
        params: { service },
      }),
      providesTags: (_result, _error, service) => [
        { type: TAG_TYPES.ROADMAP_V2_RELEASE, id: service },
      ],
      keepUnusedDataFor: 15,
    }),

    releaseRoadmapService: builder.mutation<
      RoadmapReleaseResult,
      { service: RoadmapReleaseService; serviceHeadSha: string }
    >({
      query: body => ({ url: ApiEndpoints.ROADMAP_V2_OPS.RELEASE, method: HttpMethod.POST, body }),
      invalidatesTags: (_result, _error, { service }) => [
        { type: TAG_TYPES.ROADMAP_V2_RELEASE, id: service },
        { type: TAG_TYPES.ROADMAP_V2_ITEMS, id: "LIST" },
      ],
    }),

    resumeRoadmapAutoRelease: builder.mutation<RoadmapResumeResult, void>({
      query: () => ({ url: ApiEndpoints.ROADMAP_V2_OPS.RELEASE_RESUME, method: HttpMethod.POST }),
      invalidatesTags: [TAG_TYPES.ROADMAP_V2_RELEASE, TAG_TYPES.BUILDER_SETTINGS],
    }),

    /** The roadmap fields on Builder's settings row (P0). Same route as Builder's own settings. */
    updateRoadmapV2Settings: builder.mutation<unknown, RoadmapV2SettingsPatch>({
      query: body => ({ url: ApiEndpoints.BUILDER.SETTINGS, method: HttpMethod.PATCH, body }),
      invalidatesTags: [TAG_TYPES.BUILDER_SETTINGS, TAG_TYPES.ROADMAP_V2_ROLE],
    }),
  }),
});

export const {
  useLazyGetRoadmapBriefQuery,
  useRecordRoadmapExternalBuildMutation,
  useListRoadmapRolesQuery,
  useGetRoadmapRoleForQuery,
  useSetRoadmapRoleForMutation,
  useGetRoadmapPreferencesQuery,
  useSetRoadmapPreferencesMutation,
  useGetRoadmapReleasePlanQuery,
  useReleaseRoadmapServiceMutation,
  useResumeRoadmapAutoReleaseMutation,
  useUpdateRoadmapV2SettingsMutation,
} = roadmapV2OpsAPI;
