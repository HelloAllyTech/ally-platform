import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';

import {ThreadsBottomSheet} from '../ThreadsBottomSheet';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({t: (key: string) => key}),
}));

jest.mock('@/hooks', () => ({
  useTranslate: () => ({t: (key: string) => key}),
  useUser: () => ({userData: {id: 1}}),
  useStableFooterRenderer: () => jest.fn(),
}));

jest.mock('@/contexts/ReviewApiContext', () => ({
  useReviewApiHooks: () => ({
    useLazyGetThreads: () => [
      jest.fn().mockResolvedValue({data: null}),
      {isLoading: false, isFetching: false},
    ],
  }),
}));

jest.mock('@/components', () => {
  const React = require('react');
  const {View, TouchableOpacity} = require('react-native');
  return {
    BottomSheet: ({visible, children, onClose}: any) => {
      if (!visible) {
        return null;
      }
      return React.createElement(
        View,
        {testID: 'mock-bottom-sheet'},
        React.createElement(TouchableOpacity, {
          testID: 'mock-bottom-sheet-request-close',
          onPress: () => onClose(),
        }),
        children,
      );
    },
    ConfirmationModal: () =>
      React.createElement(View, {testID: 'confirmation-modal'}),
    ReviewComment: () =>
      React.createElement(View, {testID: 'review-comment'}),
  };
});

jest.mock('@gorhom/bottom-sheet', () => {
  const RN = require('react-native');
  return {
    BottomSheetFlatList: RN.FlatList,
  };
});

jest.mock('react-native-linear-gradient', () => {
  const React = require('react');
  const {View} = require('react-native');
  return React.forwardRef((props: any, ref: any) =>
    React.createElement(View, {...props, ref, testID: 'linear-gradient'}),
  );
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0}),
}));

jest.mock('react-native-tab-view', () => {
  const React = require('react');
  const {View, Text} = require('react-native');
  return {
    TabView: ({navigationState, renderScene}: any) => {
      const index = navigationState.index ?? 0;
      const route = navigationState.routes[index];
      return React.createElement(
        View,
        {testID: 'tab-view'},
        navigationState.routes.map((r: {key: string; title: string}) =>
          React.createElement(Text, {key: r.key}, r.title),
        ),
        route ? renderScene({route}) : null,
      );
    },
    TabBar: ({children, ...rest}: any) =>
      React.createElement(View, {testID: 'tab-bar', ...rest}, children),
  };
});

jest.mock('react-native-size-matters', () => ({
  ms: (n: number) => n,
  ScaledSheet: {create: (s: Record<string, unknown>) => s},
}));

jest.mock('@/assets/icons', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    ChevronRight: (props: any) =>
      React.createElement(View, {...props, testID: 'chevron-right'}),
  };
});

jest.mock('../GeneralCommentsList', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    GeneralCommentsList: () =>
      React.createElement(View, {testID: 'general-comments-list'}),
  };
});

jest.mock('@/utils/date', () => ({
  formatRelativeTime: () => 'now',
}));

jest.mock('@/utils/reviews', () => ({
  getReactionsArray: () => [],
  getTotalReactionCount: () => 0,
}));

const defaultProps = {
  visible: true,
  onClose: jest.fn(),
  reviewId: 'review-1',
  generalCommentsThreadId: 'general-thread-1',
};

describe('ThreadsBottomSheet', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders nothing from BottomSheet when visible is false', () => {
    const {queryByTestId, queryByText} = render(
      <ThreadsBottomSheet {...defaultProps} visible={false} />,
    );

    expect(queryByTestId('mock-bottom-sheet')).toBeNull();
    expect(queryByText('threadsBottomSheet.title')).toBeNull();
  });

  it('renders header title when visible', () => {
    const {getByText} = render(<ThreadsBottomSheet {...defaultProps} />);

    expect(getByText('threadsBottomSheet.title')).toBeTruthy();
  });

  it('renders tab labels for inline and general tabs', () => {
    const {getByText} = render(<ThreadsBottomSheet {...defaultProps} />);

    expect(getByText('threadsBottomSheet.tabInline')).toBeTruthy();
    expect(getByText('threadsBottomSheet.tabGeneral')).toBeTruthy();
  });

  it('calls onClose when bottom sheet requests close', () => {
    const onClose = jest.fn();
    const {getByTestId} = render(
      <ThreadsBottomSheet {...defaultProps} onClose={onClose} />,
    );

    fireEvent.press(getByTestId('mock-bottom-sheet-request-close'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
