import React from 'react';
import {render} from '@testing-library/react-native';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({t: (key: string) => key}),
}));

jest.mock('@/hooks', () => ({
  useTranslate: () => ({t: (key: string) => key}),
}));

jest.mock('@/assets', () => ({
  animations: {thinking: 'mock-animation'},
  RankBadgeIcon: () => {
    const React = require('react');
    const {View} = require('react-native');
    return <View testID="rank-badge-icon" />;
  },
}));

jest.mock('lottie-react-native', () => {
  const React = require('react');
  const {View} = require('react-native');
  return () => <View testID="lottie-view" />;
});

jest.mock('react-native-linear-gradient', () => {
  const React = require('react');
  const {View} = require('react-native');
  return ({children, ...rest}: {children?: React.ReactNode}) => (
    <View {...rest}>{children}</View>
  );
});

import {
  AIMessageBubble,
  CitationsTable,
  ThinkingIndicator,
  UserMessageBubble,
} from '../ChatElements';
import {AskAIChatMessage, ChatMessageRole, Citation} from '../types';

const baseMessage: Omit<AskAIChatMessage, 'content' | 'citations' | 'isStreaming'> =
  {
    id: 'm1',
    role: ChatMessageRole.ASSISTANT,
    createdAt: '2024-01-01',
    updatedAt: '2024-01-01',
  };

const sampleCitations: Citation[] = [
  {
    timestamp: '00:01:02',
    content: 'Citation line A',
    senderId: 1,
    transcriptId: 10,
  },
  {
    timestamp: '00:03:04',
    content: 'Citation line B',
    senderId: -1,
    transcriptId: 11,
  },
];

describe('chatElements', () => {
  describe('UserMessageBubble', () => {
    it('renders user message content', () => {
      const message: AskAIChatMessage = {
        ...baseMessage,
        role: ChatMessageRole.USER,
        content: 'User says hello',
      };
      const {getByText} = render(<UserMessageBubble message={message} />);
      expect(getByText('User says hello')).toBeTruthy();
    });
  });

  describe('AIMessageBubble', () => {
    it('renders AI message content', () => {
      const message: AskAIChatMessage = {
        ...baseMessage,
        content: 'AI reply body',
      };
      const {getByText} = render(
        <AIMessageBubble message={message} clientName="Jordan" />,
      );
      expect(getByText('AI reply body')).toBeTruthy();
    });

    it('shows streaming cursor when isStreaming is true', () => {
      const message: AskAIChatMessage = {
        ...baseMessage,
        content: 'Partial',
        isStreaming: true,
      };
      const {getByText} = render(
        <AIMessageBubble message={message} clientName="Jordan" />,
      );
      expect(getByText('Partial▍')).toBeTruthy();
    });

    it('shows citations when not streaming and citations exist', () => {
      const message: AskAIChatMessage = {
        ...baseMessage,
        content: 'With refs',
        isStreaming: false,
        citations: sampleCitations,
      };
      const {getByText} = render(
        <AIMessageBubble message={message} clientName="Jordan" />,
      );
      expect(getByText('askAi.transcriptReferences')).toBeTruthy();
      expect(getByText('00:01:02')).toBeTruthy();
      expect(getByText(/Citation line A/)).toBeTruthy();
      expect(getByText('00:03:04')).toBeTruthy();
      expect(getByText(/Citation line B/)).toBeTruthy();
    });
  });

  describe('CitationsTable', () => {
    it('renders citation rows with timestamp and content', () => {
      const {getByText} = render(
        <CitationsTable
          citations={sampleCitations}
          clientLabel="Client X"
          youLabel="You"
        />,
      );
      expect(getByText('askAi.transcriptReferences')).toBeTruthy();
      expect(getByText('00:01:02')).toBeTruthy();
      expect(getByText(/Client X:/)).toBeTruthy();
      expect(getByText(/Citation line A/)).toBeTruthy();
      expect(getByText('00:03:04')).toBeTruthy();
      expect(getByText(/You:/)).toBeTruthy();
      expect(getByText(/Citation line B/)).toBeTruthy();
    });
  });

  describe('ThinkingIndicator', () => {
    it('renders without crashing', () => {
      const {getByTestId} = render(<ThinkingIndicator />);
      expect(getByTestId('lottie-view')).toBeTruthy();
    });
  });
});
