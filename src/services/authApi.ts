import {ALLOWED_ROLES, API_METHODS, API_ROUTES} from '@/constants';
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
        url: API_ROUTES.AUTH.GENERATE_OTP,
        method: API_METHODS.POST,
        body: {email, allowedRoles: ALLOWED_ROLES},
      }),
    }),
    verifyOtp: builder.mutation<AuthResponse, VerifyOtpRequest>({
      query: ({email, otp}) => ({
        url: API_ROUTES.AUTH.VERIFY_OTP,
        method: API_METHODS.POST,
        body: {email, otp, allowedRoles: ALLOWED_ROLES},
      }),
    }),
    getUser: builder.query<User, void>({
      query: () => API_ROUTES.USERS.ME,
    }),
    getPermissions: builder.query<string[], void>({
      query: () => API_ROUTES.AUTH.PERMISSIONS,
    }),
    checkTermsAndAgreement: builder.query<
      {success: boolean},
      string | undefined
    >({
      query: token => ({
        url: API_ROUTES.USERS.TERMS_AND_AGREEMENT,
        method: API_METHODS.GET,
        headers: token ? {Authorization: `Bearer ${token}`} : undefined,
      }),
    }),
    acceptTermsAndAgreement: builder.mutation<
      {success: boolean},
      string | undefined
    >({
      query: token => ({
        url: API_ROUTES.USERS.TERMS_AND_AGREEMENT,
        method: API_METHODS.PUT,
        headers: token ? {Authorization: `Bearer ${token}`} : undefined,
      }),
    }),
  }),
});

export const {
  useGenerateOtpMutation,
  useVerifyOtpMutation,
  useLazyGetUserQuery,
  useLazyGetPermissionsQuery,
  useLazyCheckTermsAndAgreementQuery,
  useAcceptTermsAndAgreementMutation,
} = authApi;
