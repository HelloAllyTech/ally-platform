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
import {render} from '@testing-library/react-native';

import {MessageThreadsBottomSheet} from '../MessageThreadsBottomSheet';
import type {MessageThread} from '@/types/reviews';

jest.mock('@/utils/date', () => ({
  formatRelativeTime: (d: string) => `relative-${d}`,
}));

jest.mock('@/utils/reviews', () => ({
  getReactionsArray: () => [],
  getTotalReactionCount: () => 0,
}));

jest.mock('@/components', () => {
  const React = require('react');
  const {View, Text} = require('react-native');
  return {
    BottomSheet: ({visible, children}: any) =>
      visible ? React.createElement(View, {testID: 'bottom-sheet'}, children) : null,
    ReviewComment: ({name, comment, time}: any) =>
      React.createElement(View, {testID: 'review-comment'}, [
        React.createElement(Text, {key: 'n'}, name),
        React.createElement(Text, {key: 'c'}, comment),
        React.createElement(Text, {key: 't'}, time),
      ]),
  };
});

jest.mock('@gorhom/bottom-sheet', () => ({
  BottomSheetFlatList: ({data, ListHeaderComponent, ListEmptyComponent}: any) => {
    const React = require('react');
    const {View, Text} = require('react-native');
    const Header = ListHeaderComponent;
    const Empty = ListEmptyComponent;
    return React.createElement(View, {testID: 'threads-list'}, [
      Header && React.createElement(Header, {key: 'header'}),
      data && data.length === 0 && Empty && React.createElement(Empty, {key: 'empty'}),
      data &&
        data.length > 0 &&
        data.map((item: any, i: number) =>
          React.createElement(Text, {key: item.id || i}, item.id),
        ),
    ]);
  },
}));

jest.mock('react-native-linear-gradient', () => {
  const React = require('react');
  const {View} = require('react-native');
  return ({children}: any) => React.createElement(View, {}, children);
});

jest.mock('@/assets/icons', () => ({
  ChevronRight: 'ChevronRight',
}));

const mockThreads: MessageThread[] = [
  {
    id: 'thread-1',
    comments: [
      {
        id: 'c1',
        content: 'First comment',
        createdAt: '2024-01-01T00:00:00Z',
        createdBy: {id: 1, name: 'User', profileImage: null},
        reactions: {},
        replyCount: 0,
        hidden: false,
      },
    ],
    selection: {startIndex: 0, endIndex: 5},
    createdBy: {id: 1, name: 'User', profileImage: null},
  },
];

const defaultProps = {
  visible: true,
  onClose: jest.fn(),
  message: 'Selected text here',
  messageId: 'msg-1',
  threads: mockThreads,
};

describe('MessageThreadsBottomSheet', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders nothing when visible is false', () => {
    const {queryByTestId} = render(
      <MessageThreadsBottomSheet {...defaultProps} visible={false} />,
    );
    expect(queryByTestId('bottom-sheet')).toBeNull();
  });

  it('renders bottom sheet when visible is true', () => {
    const {getByTestId} = render(
      <MessageThreadsBottomSheet {...defaultProps} />,
    );
    expect(getByTestId('bottom-sheet')).toBeTruthy();
  });

  it('renders header with title', () => {
    const {getByText} = render(
      <MessageThreadsBottomSheet {...defaultProps} />,
    );
    expect(getByText('Comments')).toBeTruthy();
  });

  it('renders empty state when threads is empty', () => {
    const {getByText} = render(
      <MessageThreadsBottomSheet
        {...defaultProps}
        threads={[]}
      />,
    );
    expect(getByText('No threads found for this message')).toBeTruthy();
  });

  it('renders thread list when threads provided', () => {
    const {getByTestId, getByText} = render(
      <MessageThreadsBottomSheet {...defaultProps} />,
    );
    expect(getByTestId('threads-list')).toBeTruthy();
    expect(getByText('thread-1')).toBeTruthy();
  });
});
