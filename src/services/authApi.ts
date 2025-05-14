import {User} from '@/types/user';

import {api} from './api';

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
}

export interface GenerateOtpRequest {
  phone: string;
}

export interface VerifyOtpRequest {
  phone: string;
  otp: string;
}

export const authApi = api.injectEndpoints({
  endpoints: builder => ({
    generateOtp: builder.mutation<{success: boolean}, GenerateOtpRequest>({
      query: ({phone}) => ({
        url: '/auth/generate-otp',
        method: 'POST',
        body: {phone},
      }),
    }),
    verifyOtp: builder.mutation<AuthResponse, VerifyOtpRequest>({
      query: ({phone, otp}) => ({
        url: '/auth/verify-otp',
        method: 'POST',
        body: {phone, otp},
      }),
    }),
    getUser: builder.query<User, void>({
      query: () => '/users/me',
    }),
  }),
});

export const {
  useGenerateOtpMutation,
  useVerifyOtpMutation,
  useLazyGetUserQuery,
} = authApi;
