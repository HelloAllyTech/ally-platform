jest.mock('@/hooks', () => {
  const en = require('@/localization/locales/en.json');
  const resolve = (key, vars = {}) => {
    const val = String(key)
      .split('.')
      .reduce((o, p) => (o == null ? undefined : o[p]), en);
    let s = typeof val === 'string' ? val : key;
    Object.keys(vars || {}).forEach(k => {
      s = s.split('{{' + k + '}}').join(String(vars[k]));
    });
    return s;
  };
  return {useTranslate: () => ({t: resolve, tVariable: resolve})};
});

import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';

import {Conversation} from '../Conversation';
import type {MessageData} from '@/types/reviews';

jest.mock('@/components/CommentableText', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    AndroidCommentableText: ({children}: any) =>
      React.createElement(View, {testID: 'android-commentable'}, children),
    IosCommentableText: () =>
      React.createElement(View, {testID: 'ios-commentable'}),
  };
});

jest.mock('@/components/Message', () => {
  const React = require('react');
  const {View, Text} = require('react-native');
  return {
    Message: ({timestamp, message}: any) =>
      React.createElement(View, {testID: 'message-component'}, [
        React.createElement(Text, {key: 'ts'}, timestamp),
        message,
      ]),
  };
});

const mockMessages: MessageData[] = [
  {
    id: 'msg-1',
    content: 'Hello',
    createdAt: '',
    startSeconds: 0,
    endSeconds: 5,
    senderId: 1,
    messagePart: [{text: 'Hello', commentIds: [], start: 0, end: 5}],
  },
  {
    id: 'msg-2',
    content: 'Hi there',
    createdAt: '',
    startSeconds: 10,
    endSeconds: 15,
    senderId: -1,
    messagePart: [{text: 'Hi there', commentIds: ['c1'], start: 0, end: 8}],
  },
];

describe('Conversation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders empty state when no messages', () => {
    const {getByText} = render(<Conversation messages={[]} />);
    expect(getByText('No messages found.')).toBeTruthy();
  });

  it('renders FlatList with messages', () => {
    const {UNSAFE_getByType} = render(
      <Conversation messages={mockMessages} />,
    );
    const {FlatList} = require('react-native');
    const list = UNSAFE_getByType(FlatList);
    expect(list.props.data).toEqual(mockMessages);
  });

  it('renders list header when provided', () => {
    const {Text} = require('react-native');
    const Header = () => React.createElement(Text, {}, 'Header');
    const {getByText} = render(
      <Conversation messages={[]} listHeaderComponent={<Header />} />,
    );
    expect(getByText('Header')).toBeTruthy();
  });

  it('calls onLoadMore when hasMore and list reaches end', () => {
    const onLoadMore = jest.fn();
    const {UNSAFE_getByType} = render(
      <Conversation
        messages={mockMessages}
        hasMore
        onLoadMore={onLoadMore}
      />,
    );
    const {FlatList} = require('react-native');
    const list = UNSAFE_getByType(FlatList);
    expect(list.props.onEndReached).toBe(onLoadMore);
  });

  it('does not set onEndReached when hasMore is false', () => {
    const {UNSAFE_getByType} = render(
      <Conversation messages={mockMessages} hasMore={false} />,
    );
    const {FlatList} = require('react-native');
    const list = UNSAFE_getByType(FlatList);
    expect(list.props.onEndReached).toBeUndefined();
  });

  it('shows footer loader when isLoadingMore', () => {
    const {UNSAFE_getAllByType} = render(
      <Conversation messages={mockMessages} isLoadingMore hasMore={false} />,
    );
    const {ActivityIndicator} = require('react-native');
    const indicators = UNSAFE_getAllByType(ActivityIndicator);
    expect(indicators.length).toBeGreaterThan(0);
  });

  it('renders list footer when hasMore is false and listFooterComponent provided', () => {
    const {Text} = require('react-native');
    const Footer = () => React.createElement(Text, {}, 'Footer');
    const {getByText} = render(
      <Conversation
        messages={mockMessages}
        hasMore={false}
        listFooterComponent={<Footer />}
      />,
    );
    expect(getByText('Footer')).toBeTruthy();
  });

  it('passes onRefresh and isRefreshing to FlatList', () => {
    const onRefresh = jest.fn();
    const {UNSAFE_getByType} = render(
      <Conversation messages={mockMessages} onRefresh={onRefresh} isRefreshing />,
    );
    const {FlatList} = require('react-native');
    const list = UNSAFE_getByType(FlatList);
    expect(list.props.onRefresh).toBe(onRefresh);
    expect(list.props.refreshing).toBe(true);
  });
});
