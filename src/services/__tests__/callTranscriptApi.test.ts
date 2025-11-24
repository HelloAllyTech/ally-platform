// Mock base API deps
jest.mock('@/store/store', () => ({ store: { dispatch: jest.fn() } }));
jest.mock('@/store/slices/userSlice', () => ({
  handleLogout: () => ({ type: 'logout' }),
  storeTokens: (p: any) => ({ type: 'storeTokens', payload: p }),
}));
jest.mock('@/utils/asyncStorage', () => ({ getItem: jest.fn(async () => undefined) }));
jest.mock('@/config/env', () => ({ env: { API_BASE_URL: 'https://example.com', API_VERSION: 'v1' } }));

import {callTranscriptApi} from '../callTranscriptApi';

describe('callTranscriptApi', () => {
  it('exposes call transcript endpoints', () => {
    const e = (callTranscriptApi as any).endpoints;
    expect(e.getChatMessages).toBeTruthy();
  });

  it('exports hooks', () => {
    const {useLazyGetChatMessagesQuery} = require('../callTranscriptApi');
    expect(useLazyGetChatMessagesQuery).toBeDefined();
  });

  it('getChatMessages endpoint is defined', () => {
    const endpoint = (callTranscriptApi as any).endpoints.getChatMessages;
    expect(endpoint.matchFulfilled).toBeDefined();
  });
});

