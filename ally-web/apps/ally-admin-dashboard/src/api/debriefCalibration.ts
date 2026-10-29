import { ApiEndpoints, HttpMethod, TAG_TYPES } from "@constants";
import {
  DebriefCalibrationAgreement,
  DebriefCalibrationItem,
  DebriefCalibrationSample,
  DebriefRating,
} from "@types";

import { baseAPI } from "./baseApi";

/**
 * The debrief calibration set. A submit refreshes the sample (rater counts), the agreement and
 * the rated item, so the list, the gate and the drawer never disagree.
 * `url` is read inside each query, not at module load — suites mock `@constants` wholesale.
 */
export const debriefCalibrationAPI = baseAPI.injectEndpoints({
  endpoints: builder => ({
    getDebriefCalibrationSample: builder.query<DebriefCalibrationSample, void>({
      query: () => ({ url: ApiEndpoints.DEBRIEF_CALIBRATION.SAMPLE, method: HttpMethod.GET }),
      providesTags: [TAG_TYPES.DEBRIEF_CALIBRATION],
    }),
    getDebriefCalibrationAgreement: builder.query<DebriefCalibrationAgreement, void>({
      query: () => ({ url: ApiEndpoints.DEBRIEF_CALIBRATION.AGREEMENT, method: HttpMethod.GET }),
      providesTags: [TAG_TYPES.DEBRIEF_CALIBRATION],
    }),
    getDebriefCalibrationItem: builder.query<DebriefCalibrationItem, string>({
      query: sessionId => ({
        url: ApiEndpoints.DEBRIEF_CALIBRATION.ITEM(sessionId),
        method: HttpMethod.GET,
      }),
      providesTags: (_r, _e, sessionId) => [{ type: TAG_TYPES.DEBRIEF_CALIBRATION, id: sessionId }],
    }),
    submitDebriefRating: builder.mutation<
      { created: boolean },
      { sessionId: string; rating: DebriefRating }
    >({
      query: ({ sessionId, rating }) => ({
        url: ApiEndpoints.DEBRIEF_CALIBRATION.ITEM(sessionId),
        method: HttpMethod.POST,
        body: rating,
      }),
      invalidatesTags: (_r, _e, { sessionId }) => [
        TAG_TYPES.DEBRIEF_CALIBRATION,
        { type: TAG_TYPES.DEBRIEF_CALIBRATION, id: sessionId },
      ],
    }),
  }),
});

export const {
  useGetDebriefCalibrationSampleQuery,
  useGetDebriefCalibrationAgreementQuery,
  useGetDebriefCalibrationItemQuery,
  useSubmitDebriefRatingMutation,
} = debriefCalibrationAPI;
