import {API_METHODS, API_ROUTES} from '@/constants';
import {User, UserRole} from '@/types';

import {api} from './api';

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
}

export interface GenerateOtpRequest {
  email: string;
  allowedRoles: UserRole[];
}

export interface VerifyOtpRequest {
  email: string;
  otp: string;
  allowedRoles: UserRole[];
}

export const authApi = api.injectEndpoints({
  endpoints: builder => ({
    generateOtp: builder.mutation<{success: boolean}, GenerateOtpRequest>({
      query: ({email, allowedRoles}) => ({
        url: API_ROUTES.AUTH.GENERATE_OTP,
        method: API_METHODS.POST,
        body: {email, allowedRoles},
      }),
    }),
    verifyOtp: builder.mutation<AuthResponse, VerifyOtpRequest>({
      query: ({email, otp, allowedRoles}) => ({
        url: API_ROUTES.AUTH.VERIFY_OTP,
        method: API_METHODS.POST,
        body: {email, otp, allowedRoles},
      }),
    }),
    getUser: builder.query<User, void>({
      query: () => API_ROUTES.USERS.ME,
    }),
    getPermissions: builder.query<string[], void>({
      query: () => API_ROUTES.AUTH.PERMISSIONS,
    }),
  }),
});

export const {
  useGenerateOtpMutation,
  useVerifyOtpMutation,
  useLazyGetUserQuery,
  useLazyGetPermissionsQuery,
} = authApi;
