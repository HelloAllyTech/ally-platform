import {AppState} from 'react-native';
import {renderHook, waitFor} from '@testing-library/react-native';
import {act} from 'react-test-renderer';

import {useListeningCommon} from '../useListeningCommon';

// Mock keep awake
jest.mock('@sayem314/react-native-keep-awake', () => ({
  activateKeepAwake: jest.fn(),
  deactivateKeepAwake: jest.fn(),
}));

// Mock AppState
jest.spyOn(AppState, 'addEventListener').mockImplementation(
  ((_e: any, _cb: any) => ({remove: jest.fn()})) as any,
);

// Mock dependencies
jest.mock('@react-navigation/native', () => ({
  useIsFocused: () => true,
}));

const mockReplace = jest.fn();
const mockGoBack = jest.fn();
const mockSetOptions = jest.fn();
jest.mock('@/hooks', () => ({
  useAppNavigation: () => ({
    replace: mockReplace,
    goBack: mockGoBack,
    setOptions: mockSetOptions,
  }),
  useCounselorChat: () => ({
    checkCounselorChat: jest.fn(),
  }),
}));

const mockEndCall = jest.fn();
const mockGetCounsellorChat = jest.fn().mockResolvedValue({data: []});
jest.mock('@/services/chatApi', () => ({
  useEndCallMutation: () => [mockEndCall, {isSuccess: false, isError: false}],
  useLazyGetCounsellorChatQuery: () => [mockGetCounsellorChat],
}));

const mockDispatch = jest.fn();
let mockState = {
  chat: {currentChat: {chatId: 123, provider: undefined}},
  user: {permissions: []},
};
jest.mock('@/store/hooks', () => ({
  useAppDispatch: () => mockDispatch,
  useAppSelector: (selector: any) => selector(mockState),
}));


describe('useListeningCommon', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockState = {
      chat: {currentChat: {chatId: 123, provider: undefined}},
      user: {permissions: []},
    };
  });

  it('should initialize with correct default state', () => {
    const {result} = renderHook(() =>
      useListeningCommon({
        isMicrophoneMode: false,
      }),
    );

    expect(result.current.isFocusMode).toBe(true);
    expect(result.current.currentNudge).toBe(null);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.showCallEndConfirmation).toBe(false);
    expect(result.current.isBannerDismissed).toBe(false);
    expect(result.current.isPrivacyTooltipVisible).toBe(false);
    expect(result.current.isControlSectionMaximized).toBe(true);
    expect(result.current.disconnectedType).toBe(null);
  });

  it('should return chat data from Redux store', () => {
    const {result} = renderHook(() =>
      useListeningCommon({
        isMicrophoneMode: false,
      }),
    );

    expect(result.current.chatData).toEqual({
      chatId: 123,
      provider: undefined,
    });
  });

  it('should toggle focus mode', () => {
    const {result} = renderHook(() =>
      useListeningCommon({
        isMicrophoneMode: false,
      }),
    );

    expect(result.current.isFocusMode).toBe(true);

    act(() => {
      result.current.toggleFocusMode();
    });

    expect(result.current.isFocusMode).toBe(false);

    act(() => {
      result.current.toggleFocusMode();
    });

    expect(result.current.isFocusMode).toBe(true);
  });

  it('should toggle privacy tooltip visibility', () => {
    const {result} = renderHook(() =>
      useListeningCommon({
        isMicrophoneMode: false,
      }),
    );

    expect(result.current.isPrivacyTooltipVisible).toBe(false);

    act(() => {
      result.current.handleLockIconPress();
    });

    expect(result.current.isPrivacyTooltipVisible).toBe(true);

    act(() => {
      result.current.handlePrivacyTooltipClose();
    });

    expect(result.current.isPrivacyTooltipVisible).toBe(false);
  });

  it('should handle end call correctly', () => {
    const {result} = renderHook(() =>
      useListeningCommon({
        isMicrophoneMode: false,
      }),
    );

    act(() => {
      result.current.handleEndCall();
    });

    expect(mockEndCall).toHaveBeenCalledWith({chatId: 123});
  });

  it('should handle end call with stop streaming for microphone mode', () => {
    const mockStopStreaming = jest.fn();
    const {result} = renderHook(() =>
      useListeningCommon({
        isMicrophoneMode: true,
      }),
    );

    act(() => {
      result.current.handleEndCall(mockStopStreaming);
    });

    expect(mockStopStreaming).toHaveBeenCalled();
    expect(mockEndCall).toHaveBeenCalledWith({chatId: 123});
  });

  it('should not stop streaming for web microphone mode', () => {
    const mockStopStreaming = jest.fn();
    // Set up mock state for web microphone mode
    const originalState = mockState;
    (mockState as any) = {
      chat: {
        currentChat: {
          chatId: 123,
          provider: 'MICROPHONE',
          platform: 'WEB',
        },
      },
      user: {permissions: []},
    };

    const {result} = renderHook(() =>
      useListeningCommon({
        isMicrophoneMode: true,
      }),
    );

    act(() => {
      result.current.handleEndCall(mockStopStreaming);
    });

    expect(mockStopStreaming).not.toHaveBeenCalled();
    expect(mockEndCall).toHaveBeenCalledWith({chatId: 123});

    // Restore original state
    mockState = originalState;
  });

  it('should handle go back', () => {
    const {result} = renderHook(() =>
      useListeningCommon({
        isMicrophoneMode: false,
      }),
    );

    act(() => {
      result.current.handleGoBack();
    });

    expect(mockDispatch).toHaveBeenCalled();
    expect(mockGoBack).toHaveBeenCalled();
  });

  it('should handle nudge feedback success', () => {
    const {result} = renderHook(() =>
      useListeningCommon({
        isMicrophoneMode: false,
      }),
    );

    const mockNudge = {
      id: 1,
      content: 'Test nudge',
      chatId: 123,
      senderId: 456,
      createdAt: '2024-01-01',
      feedback: undefined,
    };

    act(() => {
      result.current.setCurrentNudge(mockNudge);
    });

    expect(result.current.currentNudge).toEqual(mockNudge);

    const mockFeedback = {
      rating: 5,
      messageId: 1,
      userId: 456,
      modifiedContent: null,
      createdAt: '2024-01-01',
      updatedAt: '2024-01-01',
      feedbackId: 1,
    };

    act(() => {
      result.current.handleNudgeFeedbackSuccess(mockFeedback);
    });

    expect(result.current.currentNudge?.feedback).toEqual(mockFeedback);
  });

  it('should set navigation options based on microphone mode', async () => {
    renderHook(() =>
      useListeningCommon({
        isMicrophoneMode: true,
      }),
    );

    await waitFor(() => {
      expect(mockSetOptions).toHaveBeenCalledWith({
        gestureEnabled: false,
      });
    });
  });

  it('should compute canShowFocusModeButton correctly', () => {
    // Update mockState before the hook is rendered
    const originalState = mockState;
    (mockState as any) = {
      chat: {currentChat: {chatId: 123, provider: undefined}},
      user: {permissions: ['view:reference-document']},
    };

    const {result} = renderHook(() =>
      useListeningCommon({
        isMicrophoneMode: false,
      }),
    );

    expect(result.current.canShowFocusModeButton).toBe(true);

    // Restore original state
    mockState = originalState;
  });

  it('should activate keep awake on mount and deactivate on unmount', () => {
    const {
      activateKeepAwake,
      deactivateKeepAwake,
    } = require('@sayem314/react-native-keep-awake');

    const {unmount} = renderHook(() =>
      useListeningCommon({
        isMicrophoneMode: false,
      }),
    );

    expect(activateKeepAwake).toHaveBeenCalledTimes(1);

    unmount();
    expect(deactivateKeepAwake).toHaveBeenCalledTimes(1);
  });

  it('should process transcriptions correctly', () => {
    const {result} = renderHook(() =>
      useListeningCommon({
        isMicrophoneMode: true,
      }),
    );

    const payload = {
      id: 1,
      content: 'Hello',
      senderId: 456,
      createdAt: '2024-01-01T10:00:00Z',
      isFinal: false,
      isSentenceComplete: false,
    };

    act(() => {
      result.current.processTranscription(
        result.current.setSpeakerTranscriptions,
        payload,
      );
    });

    expect(result.current.speakerTranscriptions).toHaveLength(1);
    expect(result.current.speakerTranscriptions[0].message).toBe('Hello');

    // Update partial transcription
    act(() => {
      result.current.processTranscription(
        result.current.setSpeakerTranscriptions,
        {...payload, content: 'Hello world'},
      );
    });

    expect(result.current.speakerTranscriptions).toHaveLength(1);
    expect(result.current.speakerTranscriptions[0].message).toBe('Hello world');

    // Finalize it
    act(() => {
      result.current.processTranscription(
        result.current.setSpeakerTranscriptions,
        {...payload, content: 'Hello world', isFinal: true},
      );
    });

    expect(result.current.speakerTranscriptions[0].isFinal).toBe(true);

    // New transcription after final
    act(() => {
      result.current.processTranscription(
        result.current.setSpeakerTranscriptions,
        {...payload, id: 2, content: 'New', isFinal: false},
      );
    });

    expect(result.current.speakerTranscriptions).toHaveLength(2);
  });

  it('should update last transcription to final', () => {
    const {result} = renderHook(() =>
      useListeningCommon({
        isMicrophoneMode: true,
      }),
    );

    act(() => {
      result.current.setMyTranscriptions([
        {
          id: 1,
          message: 'Test',
          senderId: 123,
          timestamp: '...',
          isFinal: false,
        },
      ]);
    });

    act(() => {
      result.current.updateLastTranscription(result.current.setMyTranscriptions);
    });

    expect(result.current.myTranscriptions[0].isFinal).toBe(true);
  });
});
