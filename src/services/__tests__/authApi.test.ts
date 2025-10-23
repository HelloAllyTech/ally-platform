// Mock modules used by api.ts to avoid importing the real Redux store
jest.mock('@/store/store', () => ({ store: { dispatch: jest.fn() } }));
jest.mock('@/store/slices/userSlice', () => ({
  handleLogout: () => ({ type: 'logout' }),
  storeTokens: (p: any) => ({ type: 'storeTokens', payload: p }),
}));
jest.mock('@/utils/asyncStorage', () => ({ getItem: jest.fn(async () => undefined) }));
jest.mock('@/config/env', () => ({ env: { API_BASE_URL: 'https://example.com', API_VERSION: 'v1' } }));

import {UserRole} from '@/types';

import {authApi, GenerateOtpRequest, VerifyOtpRequest} from '../authApi';

describe('authApi endpoints', () => {
  it('defines generateOtp and verifyOtp endpoints', () => {
    // The injected endpoints decorate api endpoints internally
    expect(typeof (authApi as any).endpoints.generateOtp).toBe('object');
    expect(typeof (authApi as any).endpoints.verifyOtp).toBe('object');
  });

  describe('endpoint interfaces', () => {
    it('should have correct GenerateOtpRequest interface', () => {
      const request: GenerateOtpRequest = {
        email: 'test@example.com',
        allowedRoles: [UserRole.COUNSELOR, UserRole.LEARNER],
      };
      
      expect(request.email).toBe('test@example.com');
      expect(request.allowedRoles).toEqual([UserRole.COUNSELOR, UserRole.LEARNER]);
    });

    it('should have correct VerifyOtpRequest interface', () => {
      const request: VerifyOtpRequest = {
        email: 'test@example.com',
        otp: '123456',
        allowedRoles: [UserRole.ADMIN, UserRole.SUPER_ADMIN],
      };
      
      expect(request.email).toBe('test@example.com');
      expect(request.otp).toBe('123456');
      expect(request.allowedRoles).toEqual([UserRole.ADMIN, UserRole.SUPER_ADMIN]);
    });

    it('should support all user roles in allowedRoles', () => {
      const allRoles = [
        UserRole.CLIENT,
        UserRole.COUNSELOR,
        UserRole.LEARNER,
        UserRole.ADMIN,
        UserRole.SUPER_ADMIN,
      ];

      const request: GenerateOtpRequest = {
        email: 'test@example.com',
        allowedRoles: allRoles,
      };
      
      expect(request.allowedRoles).toHaveLength(5);
      expect(request.allowedRoles).toContain(UserRole.ADMIN);
      expect(request.allowedRoles).toContain(UserRole.SUPER_ADMIN);
    });
  });
});


