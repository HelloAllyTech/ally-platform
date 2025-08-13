import {API_METHODS, API_ROUTES} from '@/constants';
import {
  FeedbackRequest,
  FeedbackResponse,
  LoginResponse,
  RoomCreationResponse,
  RoomDeletionResponse,
  RoomListResponse,
  ScenariosResponse,
  SendOtpResponse,
} from '@/types';

import {learnApi} from './api';

export const simulationsApi = learnApi.injectEndpoints({
  endpoints: builder => ({
    sendOtp: builder.mutation<SendOtpResponse, {email: string}>({
      query: ({email}) => ({
        url: API_ROUTES.SEND_OTP,
        method: API_METHODS.POST,
        body: {
          email: email?.trim()?.toLowerCase(),
        },
      }),
    }),

    learnVerifyOtp: builder.mutation<
      LoginResponse,
      {email: string; otp: string}
    >({
      query: ({email, otp}) => ({
        url: API_ROUTES.VERIFY_OTP,
        method: API_METHODS.POST,
        body: {
          code: otp,
          email,
        },
      }),
    }),

    createRoom: builder.mutation<RoomCreationResponse, {scenarioId: string}>({
      query: ({scenarioId}) => ({
        url: API_ROUTES.ROOMS,
        method: API_METHODS.POST,
        body: {
          script_type: scenarioId,
        },
      }),
    }),

    listRooms: builder.query<RoomListResponse, void>({
      query: () => ({
        url: API_ROUTES.ROOMS,
        method: API_METHODS.GET,
      }),
    }),

    deleteRoom: builder.mutation<RoomDeletionResponse, string>({
      query: roomId => ({
        url: `${API_ROUTES.ROOMS}/${roomId}`,
        method: API_METHODS.DELETE,
      }),
    }),

    getScenarios: builder.query<ScenariosResponse, void>({
      query: () => '/scenarios',
    }),

    addFeedback: builder.mutation<FeedbackResponse, FeedbackRequest>({
      query: ({rating, comment}) => ({
        url: API_ROUTES.FEEDBACK,
        method: API_METHODS.POST,
        body: {
          rating: rating?.toString(),
          comment,
        },
      }),
    }),
  }),
});

export const {
  useSendOtpMutation,
  useLearnVerifyOtpMutation,
  useCreateRoomMutation,
  useListRoomsQuery,
  useDeleteRoomMutation,
  useGetScenariosQuery,
  useAddFeedbackMutation,
} = simulationsApi;
