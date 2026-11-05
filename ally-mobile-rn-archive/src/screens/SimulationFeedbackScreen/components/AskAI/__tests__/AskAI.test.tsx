import React from 'react';
import {ActivityIndicator, TextInput, TouchableOpacity} from 'react-native';
import {act, fireEvent, render} from '@testing-library/react-native';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({t: (key: string) => key}),
}));

jest.mock('@/hooks', () => ({
  useTranslate: () => ({t: (key: string) => key}),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0}),
}));

jest.mock('react-native-linear-gradient', () => {
  const React = require('react');
  const {View} = require('react-native');
  return ({children, ...rest}: {children?: React.ReactNode}) => (
    <View {...rest}>{children}</View>
  );
});

jest.mock('@/assets', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    UpArrowIcon: () => <View testID="up-arrow-icon" />,
  };
});

const mockUseAskAIChat = jest.fn();
jest.mock('../useAskAIChat', () => ({
  useAskAIChat: (...args: unknown[]) => mockUseAskAIChat(...args),
}));

jest.mock('../AskAiInitialState', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    AskAiInitialState: () => <View testID="ask-ai-initial-state" />,
  };
});

jest.mock('../ChatElements', () => {
  const React = require('react');
  const {View, Text} = require('react-native');
  return {
    UserMessageBubble: ({message}: {message: {content: string}}) => (
      <View testID="user-message-bubble">
        <Text>{message.content}</Text>
      </View>
    ),
    AIMessageBubble: () => <View testID="ai-message-bubble" />,
    ThinkingIndicator: () => <View testID="thinking-indicator" />,
  };
});

jest.mock('lottie-react-native', () => {
  const React = require('react');
  const {View} = require('react-native');
  return () => <View testID="lottie-view" />;
});

import {AskAI} from '../AskAI';
import {ChatMessageRole} from '../types';

async function renderAskAI(ui: React.ReactElement) {
  const utils = render(ui);
  await act(async () => {
    await new Promise<void>(resolve => {
      setTimeout(resolve, 0);
    });
  });
  return utils;
}

const defaultChat = {
  messages: [] as Array<{
    id: string;
    role: ChatMessageRole;
    content: string;
    createdAt: string;
    updatedAt: string;
  }>,
  isStreaming: false,
  isLoading: false,
  error: null as string | null,
  isInterrupted: false,
  sendMessage: jest.fn(),
  retry: jest.fn(),
};

describe('AskAI', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAskAIChat.mockReturnValue({...defaultChat});
  });

  it('renders loading indicator when isLoading', async () => {
    mockUseAskAIChat.mockReturnValue({
      ...defaultChat,
      isLoading: true,
    });
    const {UNSAFE_getByType} = await renderAskAI(
      <AskAI clientName="Alex" scenarioSessionId="sess-1" />,
    );
    expect(UNSAFE_getByType(ActivityIndicator)).toBeTruthy();
  });

  it('renders initial state when no messages', async () => {
    const {getByTestId, queryByTestId} = await renderAskAI(
      <AskAI clientName="Alex" scenarioSessionId="sess-1" />,
    );
    expect(getByTestId('ask-ai-initial-state')).toBeTruthy();
    expect(queryByTestId('user-message-bubble')).toBeNull();
  });

  it('renders messages when present (mock 1 user message)', async () => {
    mockUseAskAIChat.mockReturnValue({
      ...defaultChat,
      messages: [
        {
          id: '1',
          role: ChatMessageRole.USER,
          content: 'Hello from user',
          createdAt: '',
          updatedAt: '',
        },
      ],
    });
    const {getByText, queryByTestId} = await renderAskAI(
      <AskAI clientName="Alex" scenarioSessionId="sess-1" />,
    );
    expect(getByText('Hello from user')).toBeTruthy();
    expect(queryByTestId('ask-ai-initial-state')).toBeNull();
  });

  it('disables send when input empty', async () => {
    const {UNSAFE_getAllByType} = await renderAskAI(
      <AskAI clientName="Alex" scenarioSessionId="sess-1" />,
    );
    const touchables = UNSAFE_getAllByType(TouchableOpacity);
    expect(touchables).toHaveLength(1);
    const sendBtn = touchables[0];
    const disabled =
      sendBtn.props.disabled ||
      sendBtn.props.accessibilityState?.disabled;
    expect(disabled).toBe(true);
  });

  it('calls sendMessage on send press with text input', async () => {
    const sendMessage = jest.fn();
    mockUseAskAIChat.mockReturnValue({
      ...defaultChat,
      sendMessage,
    });
    const {UNSAFE_getAllByType, UNSAFE_getByType} = await renderAskAI(
      <AskAI clientName="Alex" scenarioSessionId="sess-1" />,
    );
    const input = UNSAFE_getByType(TextInput);
    fireEvent.changeText(input, '  my message  ');
    const touchables = UNSAFE_getAllByType(TouchableOpacity);
    expect(touchables).toHaveLength(1);
    fireEvent.press(touchables[0]);
    expect(sendMessage).toHaveBeenCalledWith('my message');
  });

  it('shows retry button when error is set', async () => {
    mockUseAskAIChat.mockReturnValue({
      ...defaultChat,
      error: 'Network error',
    });
    const {getByText} = await renderAskAI(
      <AskAI clientName="Alex" scenarioSessionId="sess-1" />,
    );
    expect(getByText('Network error')).toBeTruthy();
    expect(getByText('common.retry')).toBeTruthy();
  });

  it('shows character limit warning when input exceeds 2000 chars', async () => {
    const {UNSAFE_getByType, getByText} = await renderAskAI(
      <AskAI clientName="Alex" scenarioSessionId="sess-1" />,
    );
    const input = UNSAFE_getByType(TextInput);
    fireEvent.changeText(input, 'x'.repeat(2001));
    expect(getByText('askAi.askAIMaxMessages')).toBeTruthy();
  });
});
