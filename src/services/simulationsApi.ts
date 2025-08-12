import {
  LoginResponse,
  RoomCreationResponse,
  RoomDeletionResponse,
  RoomListResponse,
  ScenariosResponse,
  SendOtpResponse,
} from '@/types';

import {learnApi} from './api';

// API route constants
const API_ROUTES = {
  SEND_OTP: '/auth/send-otp',
  VERIFY_OTP: '/auth/verify-otp',
  ROOMS: '/rooms',
  SCENARIOS: '/scenarios',
} as const;

const API_METHODS = {
  GET: 'GET',
  POST: 'POST',
  DELETE: 'DELETE',
} as const;

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

    verifyOtp: builder.mutation<LoginResponse, {email: string; otp: string}>({
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
  }),
});

export const {
  useSendOtpMutation,
  useVerifyOtpMutation,
  useCreateRoomMutation,
  useListRoomsQuery,
  useDeleteRoomMutation,
  useGetScenariosQuery,
} = simulationsApi;
