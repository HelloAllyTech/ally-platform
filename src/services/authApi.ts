import {ALLOWED_ROLES, API_METHODS, API_ROUTES} from '@/constants';
import {setUser} from '@/store/slices/userSlice';
import {User} from '@/types';

import {api} from './api';

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
}

export interface GenerateOtpRequest {
  email: string;
}

export interface GenerateOtpResponse {
  success: boolean;
  expiresIn?: number;
}

export interface VerifyOtpRequest {
  email: string;
  otp: string;
}

export interface GoogleLoginRequest {
  idToken: string;
}

export interface AppleLoginRequest {
  identityToken: string;
  authorizationCode?: string;
  fullName?: {
    givenName?: string | null;
    familyName?: string | null;
  };
}

export interface GetPresignedUrlRequest {
  fileName: string;
  fileSize: number;
  contentType: string;
}

export interface GetPresignedUrlResponse {
  presignedUrl: string;
  profileImageUrl: string;
}

export interface UpdateProfileImageRequest {
  profileImageUrl: string;
}

export interface CompleteProfileRequest {
  name: string;
  phone?: string;
}

export interface DeleteProfileImageRequest {
  profileImageUrl: string;
}

export interface LogoUrlResponse {
  name: string;
  logoUrl: string;
}

export const authApi = api.injectEndpoints({
  endpoints: builder => ({
    generateOtp: builder.mutation<GenerateOtpResponse, GenerateOtpRequest>({
      query: ({email}) => ({
        url: API_ROUTES.AUTH.GENERATE_OTP,
        method: API_METHODS.POST,
        body: {email, allowedRoles: ALLOWED_ROLES, appType: 'APP'},
      }),
    }),
    verifyOtp: builder.mutation<AuthResponse, VerifyOtpRequest>({
      query: ({email, otp}) => ({
        url: API_ROUTES.AUTH.VERIFY_OTP,
        method: API_METHODS.POST,
        body: {email, otp, allowedRoles: ALLOWED_ROLES},
      }),
    }),
    loginWithGoogle: builder.mutation<AuthResponse, GoogleLoginRequest>({
      query: ({idToken}) => ({
        url: API_ROUTES.AUTH.GOOGLE_LOGIN,
        method: API_METHODS.POST,
        body: {idToken, allowedRoles: ALLOWED_ROLES},
      }),
    }),
    loginWithApple: builder.mutation<AuthResponse, AppleLoginRequest>({
      query: ({identityToken, authorizationCode, fullName}) => ({
        url: API_ROUTES.AUTH.APPLE_LOGIN,
        method: API_METHODS.POST,
        body: {
          identityToken,
          authorizationCode,
          fullName,
          allowedRoles: ALLOWED_ROLES,
        },
      }),
    }),
    getUser: builder.query<User, void>({
      query: () => API_ROUTES.USERS.ME,
      providesTags: ['User'],
    }),
    getPermissions: builder.query<string[], void>({
      query: () => API_ROUTES.AUTH.PERMISSIONS,
    }),
    getProfileImagePresignedUrl: builder.mutation<
      GetPresignedUrlResponse,
      GetPresignedUrlRequest
    >({
      query: body => ({
        url: API_ROUTES.USERS.PROFILE_IMAGE_URL,
        method: API_METHODS.POST,
        body,
      }),
    }),
    updateProfileImage: builder.mutation<void, UpdateProfileImageRequest>({
      query: body => ({
        url: API_ROUTES.USERS.PROFILE_IMAGE,
        method: API_METHODS.PATCH,
        body,
      }),
      async onQueryStarted(_, {dispatch, queryFulfilled}) {
        // Invalidate and refetch user data after updating profile image
        try {
          await queryFulfilled;
          dispatch(authApi.util.invalidateTags(['User']));
          const result = await dispatch(
            authApi.endpoints.getUser.initiate(undefined, {forceRefetch: true}),
          );
          // Update Redux store with the refetched user data
          if ('data' in result && result.data) {
            dispatch(setUser(result.data));
          }
        } catch {
          // Error handling is done by RTK Query
        }
      },
    }),
    deleteProfileImage: builder.mutation<void, DeleteProfileImageRequest>({
      query: body => ({
        url: API_ROUTES.USERS.PROFILE_IMAGE,
        method: API_METHODS.DELETE,
        body,
      }),
      async onQueryStarted(_, {dispatch, queryFulfilled}) {
        // Invalidate and refetch user data after deleting profile image
        try {
          await queryFulfilled;
          dispatch(authApi.util.invalidateTags(['User']));
          const result = await dispatch(
            authApi.endpoints.getUser.initiate(undefined, {forceRefetch: true}),
          );
          // Update Redux store with the refetched user data
          if ('data' in result && result.data) {
            dispatch(setUser(result.data));
          }
        } catch {
          // Error handling is done by RTK Query
        }
      },
    }),
    completeProfile: builder.mutation<
      {success: boolean},
      CompleteProfileRequest
    >({
      query: body => ({
        url: API_ROUTES.USERS.COMPLETE_PROFILE,
        method: API_METHODS.PATCH,
        body,
      }),
      async onQueryStarted(_, {dispatch, queryFulfilled}) {
        // Refetch the user so profileCompleted flips and the gate clears.
        try {
          await queryFulfilled;
          dispatch(authApi.util.invalidateTags(['User']));
          const result = await dispatch(
            authApi.endpoints.getUser.initiate(undefined, {
              forceRefetch: true,
            }),
          );
          if ('data' in result && result.data) {
            dispatch(setUser(result.data));
          }
        } catch {
          // Error handling is done by RTK Query
        }
      },
    }),
    getLogoUrl: builder.query<LogoUrlResponse, void>({
      query: () => API_ROUTES.USERS.LOGO_URL,
    }),
  }),
});

export const {
  useGenerateOtpMutation,
  useVerifyOtpMutation,
  useLoginWithGoogleMutation,
  useLoginWithAppleMutation,
  useLazyGetUserQuery,
  useLazyGetPermissionsQuery,
  useGetProfileImagePresignedUrlMutation,
  useUpdateProfileImageMutation,
  useDeleteProfileImageMutation,
  useCompleteProfileMutation,
  useGetLogoUrlQuery,
} = authApi;
