import {User} from '@/types';

import {api} from './api';

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
}

export interface GenerateOtpRequest {
  email: string;
}

export interface VerifyOtpRequest {
  email: string;
  otp: string;
}

export const authApi = api.injectEndpoints({
  endpoints: builder => ({
    generateOtp: builder.mutation<{success: boolean}, GenerateOtpRequest>({
      query: ({email}) => ({
        url: '/auth/generate-otp',
        method: 'POST',
        body: {email},
      }),
    }),
    verifyOtp: builder.mutation<AuthResponse, VerifyOtpRequest>({
      query: ({email, otp}) => ({
        url: '/auth/verify-otp',
        method: 'POST',
        body: {email, otp},
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
