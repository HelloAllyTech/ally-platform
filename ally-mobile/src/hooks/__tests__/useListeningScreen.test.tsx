import {renderHook} from '@testing-library/react-native';

import {AllyPlatforms} from '@/constants';
import {ChatProvider} from '@/types';
import {useListeningScreen} from '@/hooks/useListeningScreen';

// Mock the useTranslate hook
jest.mock('@/hooks/useTranslate', () => ({
  useTranslate: () => ({
    t: (key: string) => key,
  }),
}));

describe('useListeningScreen', () => {
  const mockChatData = {
    provider: ChatProvider.MICROPHONE,
    platform: AllyPlatforms.MOBILE,
    startedAt: '2024-01-15T10:00:00Z',
    chatId: 123,
  };

  it('should compute isWebMicrophoneMode correctly for web microphone', () => {
    const {result} = renderHook(() =>
      useListeningScreen({
        isMicrophoneMode: true,
        isFocusMode: true,
        chatData: {
          ...mockChatData,
          provider: ChatProvider.MICROPHONE,
          platform: AllyPlatforms.WEB,
        },
      }),
    );

    expect(result.current.isWebMicrophoneMode).toBe(true);
  });

  it('should compute isWebMicrophoneMode as false for non-web microphone', () => {
    const {result} = renderHook(() =>
      useListeningScreen({
        isMicrophoneMode: true,
        isFocusMode: true,
        chatData: mockChatData,
      }),
    );

    expect(result.current.isWebMicrophoneMode).toBe(false);
  });

  it('should compute isConferenceCall correctly for conference providers', () => {
    const {result} = renderHook(() =>
      useListeningScreen({
        isMicrophoneMode: false,
        isFocusMode: true,
        chatData: {
          ...mockChatData,
          provider: ChatProvider.EXOTEL_CONFERENCE_CALL,
        },
      }),
    );

    expect(result.current.isConferenceCall).toBe(true);
  });

  it('should compute isConferenceCall as false for non-conference providers', () => {
    const {result} = renderHook(() =>
      useListeningScreen({
        isMicrophoneMode: true,
        isFocusMode: true,
        chatData: mockChatData,
      }),
    );

    expect(result.current.isConferenceCall).toBe(false);
  });

  it('should return tooltip content list', () => {
    const {result} = renderHook(() =>
      useListeningScreen({
        isMicrophoneMode: true,
        isFocusMode: true,
        chatData: mockChatData,
      }),
    );

    expect(result.current.tooltipContentList).toHaveLength(4);
    expect(result.current.tooltipContentList).toEqual([
      'audioCall.privacy.noRecording',
      'audioCall.privacy.encrypted',
      'audioCall.privacy.noTrainingData',
      'audioCall.privacy.personalInfoRemoved',
    ]);
  });

  it('should return correct tooltip display insets for focus mode', () => {
    const {result} = renderHook(() =>
      useListeningScreen({
        isMicrophoneMode: true,
        isFocusMode: true,
        chatData: mockChatData,
      }),
    );

    expect(result.current.tooltipDisplayInsets).toEqual({
      left: 40,
      right: 40,
      top: 10,
      bottom: 10,
    });
  });

  it('should return correct tooltip display insets for non-focus mode', () => {
    const {result} = renderHook(() =>
      useListeningScreen({
        isMicrophoneMode: true,
        isFocusMode: false,
        chatData: mockChatData,
      }),
    );

    expect(result.current.tooltipDisplayInsets).toEqual({
      left: 10,
      right: 10,
      top: 10,
      bottom: 10,
    });
  });

  it('should calculate start time from chatData.startedAt', () => {
    const {result} = renderHook(() =>
      useListeningScreen({
        isMicrophoneMode: true,
        isFocusMode: true,
        chatData: mockChatData,
      }),
    );

    const expectedTime = new Date('2024-01-15T10:00:00Z').getTime();
    expect(result.current.startTime).toBe(expectedTime);
  });

  it('should use current time when chatData.startedAt is not provided', () => {
    const beforeTime = Date.now();

    const {result} = renderHook(() =>
      useListeningScreen({
        isMicrophoneMode: true,
        isFocusMode: true,
        chatData: {
          ...mockChatData,
          startedAt: undefined,
        },
      }),
    );

    const afterTime = Date.now();

    expect(result.current.startTime).toBeGreaterThanOrEqual(beforeTime);
    expect(result.current.startTime).toBeLessThanOrEqual(afterTime);
  });

  it('should use current time when chatData is null', () => {
    const beforeTime = Date.now();

    const {result} = renderHook(() =>
      useListeningScreen({
        isMicrophoneMode: true,
        isFocusMode: true,
        chatData: null,
      }),
    );

    const afterTime = Date.now();

    expect(result.current.startTime).toBeGreaterThanOrEqual(beforeTime);
    expect(result.current.startTime).toBeLessThanOrEqual(afterTime);
  });

  it('should return callProvider from chatData', () => {
    const {result} = renderHook(() =>
      useListeningScreen({
        isMicrophoneMode: true,
        isFocusMode: true,
        chatData: mockChatData,
      }),
    );

    expect(result.current.callProvider).toBe(ChatProvider.MICROPHONE);
  });

  it('should update when isFocusMode changes', () => {
    const {result, rerender} = renderHook(
      ({isFocusMode}) =>
        useListeningScreen({
          isMicrophoneMode: true,
          isFocusMode,
          chatData: mockChatData,
        }),
      {
        initialProps: {isFocusMode: true},
      },
    );

    expect(result.current.tooltipDisplayInsets.left).toBe(40);

    rerender({isFocusMode: false});

    expect(result.current.tooltipDisplayInsets.left).toBe(10);
  });

  it('should update when chatData changes', () => {
    const {result, rerender} = renderHook(
      ({chatData}) =>
        useListeningScreen({
          isMicrophoneMode: true,
          isFocusMode: true,
          chatData,
        }),
      {
        initialProps: {chatData: mockChatData},
      },
    );

    expect(result.current.callProvider).toBe(ChatProvider.MICROPHONE);

    const updatedChatData = {
      ...mockChatData,
      provider: ChatProvider.EXOTEL_CONFERENCE_CALL,
    };

    rerender({chatData: updatedChatData});

    expect(result.current.callProvider).toBe(ChatProvider.EXOTEL_CONFERENCE_CALL);
    expect(result.current.isConferenceCall).toBe(true);
  });
});

