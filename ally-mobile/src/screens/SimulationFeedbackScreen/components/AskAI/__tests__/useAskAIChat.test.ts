import {act, renderHook} from '@testing-library/react-native';

import {ChatSessionState} from '../chatSessionManager';
import {ChatMessageRole} from '../types';

const mockState: ChatSessionState = {
  messages: [],
  isStreaming: false,
  isLoading: false,
  error: null,
  isHistoryLoaded: false,
  streamingMessage: null,
};

const mockSubscribe = jest.fn((_id: string, _cb: () => void) => {
  return jest.fn();
});
const mockGetSnapshot = jest.fn(() => mockState);
const mockLoadHistory = jest.fn();
const mockSendMessage = jest.fn();
const mockRetry = jest.fn();
const mockCleanup = jest.fn();
const mockDestroySession = jest.fn();

jest.mock('../chatSessionManager', () => ({
  subscribe: (id: string, cb: () => void) => mockSubscribe(id, cb),
  getSnapshot: (_id: string) => mockGetSnapshot(),
  loadHistory: (id: string) => mockLoadHistory(id),
  sendMessage: (id: string, text: string) => mockSendMessage(id, text),
  retry: (id: string) => mockRetry(id),
  cleanup: (id: string) => mockCleanup(id),
  destroySession: (id: string) => mockDestroySession(id),
}));

import {useAskAIChat} from '../useAskAIChat';

describe('useAskAIChat', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSnapshot.mockReturnValue({...mockState});
  });

  it('returns initial state from snapshot', () => {
    const {result} = renderHook(() =>
      useAskAIChat({scenarioSessionId: 'sess-1'}),
    );

    expect(result.current.messages).toEqual([]);
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.isInterrupted).toBe(false);
  });

  it('calls loadHistory when history is not loaded', () => {
    renderHook(() => useAskAIChat({scenarioSessionId: 'sess-1'}));
    expect(mockLoadHistory).toHaveBeenCalledWith('sess-1');
  });

  it('does not call loadHistory when already loaded', () => {
    mockGetSnapshot.mockReturnValue({...mockState, isHistoryLoaded: true});
    renderHook(() => useAskAIChat({scenarioSessionId: 'sess-1'}));
    expect(mockLoadHistory).not.toHaveBeenCalled();
  });

  it('subscribes to the session', () => {
    renderHook(() => useAskAIChat({scenarioSessionId: 'sess-1'}));
    expect(mockSubscribe).toHaveBeenCalledWith('sess-1', expect.any(Function));
  });

  it('sendMessage delegates to chatSessionManager', () => {
    const {result} = renderHook(() =>
      useAskAIChat({scenarioSessionId: 'sess-1'}),
    );

    act(() => {
      result.current.sendMessage('hello');
    });

    expect(mockSendMessage).toHaveBeenCalledWith('sess-1', 'hello');
  });

  it('retry delegates to chatSessionManager', () => {
    const {result} = renderHook(() =>
      useAskAIChat({scenarioSessionId: 'sess-1'}),
    );

    act(() => {
      result.current.retry();
    });

    expect(mockRetry).toHaveBeenCalledWith('sess-1');
  });

  it('cleanup delegates to chatSessionManager', () => {
    const {result} = renderHook(() =>
      useAskAIChat({scenarioSessionId: 'sess-1'}),
    );

    act(() => {
      result.current.cleanup();
    });

    expect(mockCleanup).toHaveBeenCalledWith('sess-1');
  });

  it('includes streamingMessage in allMessages when present', () => {
    const streamingMsg = {
      id: 'stream-1',
      role: ChatMessageRole.ASSISTANT,
      content: 'streaming...',
      createdAt: '',
      updatedAt: '',
    };
    mockGetSnapshot.mockReturnValue({
      ...mockState,
      messages: [
        {id: '1', role: ChatMessageRole.USER, content: 'Hi', createdAt: '', updatedAt: ''},
      ],
      streamingMessage: streamingMsg,
    });

    const {result} = renderHook(() =>
      useAskAIChat({scenarioSessionId: 'sess-1'}),
    );

    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[1].content).toBe('streaming...');
  });

  it('isInterrupted is true when last message is user and not streaming', () => {
    mockGetSnapshot.mockReturnValue({
      ...mockState,
      messages: [
        {id: '1', role: ChatMessageRole.USER, content: 'Hello', createdAt: '', updatedAt: ''},
      ],
      isStreaming: false,
    });

    const {result} = renderHook(() =>
      useAskAIChat({scenarioSessionId: 'sess-1'}),
    );

    expect(result.current.isInterrupted).toBe(true);
  });

  it('isInterrupted is false when last message is assistant', () => {
    mockGetSnapshot.mockReturnValue({
      ...mockState,
      messages: [
        {id: '1', role: ChatMessageRole.ASSISTANT, content: 'Hi!', createdAt: '', updatedAt: ''},
      ],
      isStreaming: false,
    });

    const {result} = renderHook(() =>
      useAskAIChat({scenarioSessionId: 'sess-1'}),
    );

    expect(result.current.isInterrupted).toBe(false);
  });

  it('isInterrupted is false when streaming', () => {
    mockGetSnapshot.mockReturnValue({
      ...mockState,
      messages: [
        {id: '1', role: ChatMessageRole.USER, content: 'Hello', createdAt: '', updatedAt: ''},
      ],
      isStreaming: true,
    });

    const {result} = renderHook(() =>
      useAskAIChat({scenarioSessionId: 'sess-1'}),
    );

    expect(result.current.isInterrupted).toBe(false);
  });
});
