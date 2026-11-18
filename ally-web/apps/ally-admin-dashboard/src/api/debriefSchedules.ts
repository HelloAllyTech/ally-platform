import { ApiEndpoints, HttpMethod, TAG_TYPES } from "@constants";
import {
  DebriefScheduleChange,
  DebriefScheduleJob,
  DebriefScheduleRunsPage,
  DebriefSchedulesView,
} from "@types";

import { baseAPI } from "./baseApi";

/**
 * Debrief › Settings › Schedules: engineering only (the `debrief_schedules` admin toggle).
 * `url` is read inside each query, not at module load — suites mock `@constants` wholesale.
 */
export const debriefSchedulesAPI = baseAPI.injectEndpoints({
  endpoints: builder => ({
    getDebriefSchedules: builder.query<DebriefSchedulesView, void>({
      query: () => ({ url: ApiEndpoints.DEBRIEF_CONSOLE.SCHEDULES, method: HttpMethod.GET }),
      providesTags: [TAG_TYPES.DEBRIEF_CONSOLE],
    }),
    getDebriefScheduleRuns: builder.query<
      DebriefScheduleRunsPage,
      { page: number; pageSize?: number }
    >({
      query: ({ page, pageSize = 20 }) => ({
        url: `${ApiEndpoints.DEBRIEF_CONSOLE.SCHEDULES}/runs`,
        method: HttpMethod.GET,
        params: { page, pageSize },
      }),
      providesTags: [TAG_TYPES.DEBRIEF_CONSOLE],
    }),
    updateDebriefSchedule: builder.mutation<DebriefScheduleJob, DebriefScheduleChange>({
      query: ({ key, ...body }) => ({
        url: `${ApiEndpoints.DEBRIEF_CONSOLE.SCHEDULES}/${encodeURIComponent(key)}`,
        method: HttpMethod.PATCH,
        body,
      }),
      invalidatesTags: [TAG_TYPES.DEBRIEF_CONSOLE],
    }),
  }),
});

export const {
  useGetDebriefSchedulesQuery,
  useGetDebriefScheduleRunsQuery,
  useUpdateDebriefScheduleMutation,
} = debriefSchedulesAPI;
