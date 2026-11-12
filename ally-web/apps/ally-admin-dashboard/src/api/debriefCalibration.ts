import { ApiEndpoints, HttpMethod, TAG_TYPES } from "@constants";
import { DebriefCalibrationItem } from "@types";

import { baseAPI } from "./baseApi";

/**
 * One session's place in the debrief calibration set, for "Score by hand". Scores are saved
 * through the console's `scoreDebriefSession`, which invalidates this tag.
 * `url` is read inside each query, not at module load — suites mock `@constants` wholesale.
 */
export const debriefCalibrationAPI = baseAPI.injectEndpoints({
  endpoints: builder => ({
    getDebriefCalibrationItem: builder.query<DebriefCalibrationItem, string>({
      query: sessionId => ({
        url: ApiEndpoints.DEBRIEF_CALIBRATION.ITEM(sessionId),
        method: HttpMethod.GET,
      }),
      providesTags: (_r, _e, sessionId) => [{ type: TAG_TYPES.DEBRIEF_CALIBRATION, id: sessionId }],
    }),
  }),
});

export const { useGetDebriefCalibrationItemQuery } = debriefCalibrationAPI;
