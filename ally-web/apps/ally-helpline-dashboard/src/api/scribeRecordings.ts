import { HttpMethod } from "@constants";

import { baseAPI } from "./baseAPI";

/**
 * Segmented Scribe recording (ally-be /v1/scribe-recordings): the browser
 * uploads ~30 s segments straight to S3 and finalizes on Stop, so no server
 * holds the audio.
 */
export interface ScribeRecordingConfig {
  enabled: boolean;
  segmentSeconds: number;
  maxSegments: number;
}

const scribeRecordingsAPI = baseAPI.injectEndpoints({
  endpoints: builder => ({
    getScribeRecordingConfig: builder.query<ScribeRecordingConfig, void>({
      query: () => "/v1/scribe-recordings/config",
    }),
    startScribeRecording: builder.mutation<
      { chatId: number; segmentSeconds: number; maxSegments: number },
      { platform: "WEB"; format: "webm" }
    >({
      query: body => ({ url: "/v1/scribe-recordings", method: HttpMethod.POST, body }),
    }),
    getSegmentUploadUrl: builder.mutation<
      { url: string; key: string; expiresIn: number },
      { chatId: number; index: number; contentType: string }
    >({
      query: ({ chatId, index, contentType }) => ({
        url: `/v1/scribe-recordings/${chatId}/segments/${index}/upload-url`,
        method: HttpMethod.POST,
        body: { contentType },
      }),
    }),
    finalizeScribeRecording: builder.mutation<
      { status: "finalized" | "already-finalized"; missing: number[] },
      { chatId: number; segmentCount: number; durationSeconds?: number; allowPartial?: boolean }
    >({
      query: ({ chatId, ...body }) => ({
        url: `/v1/scribe-recordings/${chatId}/finalize`,
        method: HttpMethod.POST,
        body,
      }),
    }),
  }),
});

export const {
  useGetScribeRecordingConfigQuery,
  useStartScribeRecordingMutation,
  useGetSegmentUploadUrlMutation,
  useFinalizeScribeRecordingMutation,
} = scribeRecordingsAPI;
