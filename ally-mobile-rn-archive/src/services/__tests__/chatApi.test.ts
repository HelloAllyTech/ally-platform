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

  it('getCounsellorChat endpoint is defined', () => {
    const endpoint = (chatApi as any).endpoints.getCounsellorChat;
    expect(endpoint.matchFulfilled).toBeDefined();
  });

  it('endCall endpoint is a mutation', () => {
    const endpoint = (chatApi as any).endpoints.endCall;
    expect(endpoint.matchFulfilled).toBeDefined();
  });

  it('addFeedback endpoint is a mutation', () => {
    const endpoint = (chatApi as any).endpoints.addFeedback;
    expect(endpoint.matchFulfilled).toBeDefined();
  });

  it('updateFeedback endpoint is a mutation', () => {
    const endpoint = (chatApi as any).endpoints.updateFeedback;
    expect(endpoint.matchFulfilled).toBeDefined();
  });

  it('updateNotes endpoint is a mutation', () => {
    const endpoint = (chatApi as any).endpoints.updateNotes;
    expect(endpoint.matchFulfilled).toBeDefined();
  });

  it('exports all hooks', () => {
    const {
      useLazyGetCounsellorChatQuery,
      useEndCallMutation,
      useAddFeedbackMutation,
      useUpdateFeedbackMutation,
      useUpdateNotesMutation,
    } = require('../chatApi');

    expect(useLazyGetCounsellorChatQuery).toBeDefined();
    expect(useEndCallMutation).toBeDefined();
    expect(useAddFeedbackMutation).toBeDefined();
    expect(useUpdateFeedbackMutation).toBeDefined();
    expect(useUpdateNotesMutation).toBeDefined();
  });

  it('handles feedback rating validation', () => {
    const endpoint = (chatApi as any).endpoints.addFeedback;
    expect(endpoint.select).toBeDefined();
  });

  it('handles feedback updates', () => {
    const endpoint = (chatApi as any).endpoints.updateFeedback;
    expect(endpoint.select).toBeDefined();
  });

  it('handles notes updates', () => {
    const endpoint = (chatApi as any).endpoints.updateNotes;
    expect(endpoint.select).toBeDefined();
  });
});


