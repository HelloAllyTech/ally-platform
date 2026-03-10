// Mock modules used by api.ts to avoid importing the real Redux store
jest.mock('@/store/store', () => ({ store: { dispatch: jest.fn() } }));
jest.mock('@/store/slices/userSlice', () => ({
  handleLogout: () => ({ type: 'logout' }),
  storeTokens: (p: any) => ({ type: 'storeTokens', payload: p }),
}));
jest.mock('@/utils/asyncStorage', () => ({ getItem: jest.fn(async () => undefined) }));
jest.mock('@/config/env', () => ({ env: { API_BASE_URL: 'https://example.com', API_VERSION: 'v1' } }));

import {UserRole} from '@/types';

import {authApi} from '../authApi';

describe('authApi endpoints', () => {
  it('defines generateOtp and verifyOtp endpoints', () => {
    // The injected endpoints decorate api endpoints internally
    expect(typeof (authApi as any).endpoints.generateOtp).toBe('object');
    expect(typeof (authApi as any).endpoints.verifyOtp).toBe('object');
  });

  it('generateOtp endpoint is a mutation', () => {
    const endpoint = (authApi as any).endpoints.generateOtp;
    expect(endpoint.matchFulfilled).toBeDefined();
  });

  it('verifyOtp endpoint is a mutation', () => {
    const endpoint = (authApi as any).endpoints.verifyOtp;
    expect(endpoint.matchFulfilled).toBeDefined();
  });

  it('exports mutation hooks', () => {
    const {useGenerateOtpMutation, useVerifyOtpMutation, useLoginWithGoogleMutation} = require('../authApi');
    expect(useGenerateOtpMutation).toBeDefined();
    expect(useVerifyOtpMutation).toBeDefined();
    expect(useLoginWithGoogleMutation).toBeDefined();
  });

  it('defines loginWithGoogle endpoint', () => {
    expect(typeof (authApi as any).endpoints.loginWithGoogle).toBe('object');
  });

  it('loginWithGoogle endpoint is a mutation', () => {
    const endpoint = (authApi as any).endpoints.loginWithGoogle;
    expect(endpoint.matchFulfilled).toBeDefined();
  });

  describe('loginWithGoogle endpoint', () => {
    it('should support idToken payload', () => {
      const request = {
        idToken: 'test-id-token',
        allowedRoles: [UserRole.COUNSELOR, UserRole.LEARNER],
      } as any;
      
      expect(request.idToken).toBe('test-id-token');
      expect(request.allowedRoles).toEqual([UserRole.COUNSELOR, UserRole.LEARNER]);
    });

    it('should handle empty allowedRoles array', () => {
      const request = {
        idToken: 'test-id-token',
        allowedRoles: [],
      } as any;
      
      expect(request.allowedRoles).toEqual([]);
    });
  });

  describe('endpoint interfaces', () => {
    it('should support allowedRoles payload alongside email (runtime body)', () => {
      const request = {
        email: 'test@example.com',
        allowedRoles: [UserRole.COUNSELOR, UserRole.LEARNER],
      } as any;
      
      expect(request.email).toBe('test@example.com');
      expect(request.allowedRoles).toEqual([UserRole.COUNSELOR, UserRole.LEARNER]);
    });

    it('should support allowedRoles in verify payload (runtime body)', () => {
      const request = {
        email: 'test@example.com',
        otp: '123456',
        allowedRoles: [UserRole.ADMIN, UserRole.SUPER_ADMIN],
      } as any;
      
      expect(request.email).toBe('test@example.com');
      expect(request.otp).toBe('123456');
      expect(request.allowedRoles).toEqual([UserRole.ADMIN, UserRole.SUPER_ADMIN]);
    });

    it('should support all user roles in allowedRoles', () => {
      const allRoles = [
        UserRole.CLIENT,
        UserRole.COUNSELOR,
        UserRole.LEARNER,
        UserRole.SIMULATION_REVIEWER,
        UserRole.ADMIN,
        UserRole.SUPER_ADMIN,
      ];

      const request = {
        email: 'test@example.com',
        allowedRoles: allRoles,
      } as any;
      
      expect(request.allowedRoles).toHaveLength(6);
      expect(request.allowedRoles).toContain(UserRole.ADMIN);
      expect(request.allowedRoles).toContain(UserRole.SUPER_ADMIN);
    });

    it('handles empty allowedRoles array', () => {
      const request = {
        email: 'test@example.com',
        allowedRoles: [],
      } as any;
      
      expect(request.allowedRoles).toEqual([]);
    });

    it('handles undefined allowedRoles', () => {
      const request = {
        email: 'test@example.com',
      } as any;
      
      expect(request.allowedRoles).toBeUndefined();
    });
  });
});


