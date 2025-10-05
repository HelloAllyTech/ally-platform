// Mock base API deps
jest.mock('@/store/store', () => ({ store: { dispatch: jest.fn() } }));
jest.mock('@/store/slices/userSlice', () => ({
  handleLogout: () => ({ type: 'logout' }),
  storeTokens: (p: any) => ({ type: 'storeTokens', payload: p }),
}));
jest.mock('@/utils/asyncStorage', () => ({ getItem: jest.fn(async () => undefined) }));
jest.mock('@/config/env', () => ({ env: { API_BASE_URL: 'https://example.com', API_VERSION: 'v1' } }));

import {chatApi} from '../chatApi';

describe('chatApi', () => {
  it('exposes chat-related endpoints', () => {
    const endpoints = (chatApi as any).endpoints;
    expect(endpoints.getCounsellorChat).toBeTruthy();
    expect(endpoints.endCall).toBeTruthy();
    expect(endpoints.addFeedback).toBeTruthy();
    expect(endpoints.updateFeedback).toBeTruthy();
    expect(endpoints.updateNotes).toBeTruthy();
  });
});


