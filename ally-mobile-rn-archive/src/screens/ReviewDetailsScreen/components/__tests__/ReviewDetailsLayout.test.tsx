import React from 'react';
import {ActivityIndicator} from 'react-native';
import {fireEvent, render} from '@testing-library/react-native';

import {ReviewDetailsLayout} from '../ReviewDetailsLayout';

const mockGoBack = jest.fn();

jest.mock('../GeneralCommentsSection', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    GeneralCommentsSection: () =>
      React.createElement(View, {testID: 'general-comments-section'}),
  };
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({t: (key: string) => key}),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0}),
}));

jest.mock('@/hooks', () => ({
  useAppNavigation: () => ({goBack: mockGoBack}),
  useTranslate: () => ({t: (key: string) => key}),
  useUser: () => ({userData: {id: 1, name: 'Test User'}}),
}));

jest.mock('@/assets', () => {
  const React = require('react');
  const {TouchableOpacity} = require('react-native');
  return {
    LeftArrow: () =>
      React.createElement(
        TouchableOpacity,
        {testID: 'back-button', onPress: () => mockGoBack()},
        null,
      ),
  };
});

jest.mock('@/components', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    Conversation: ({
      listHeaderComponent,
    }: {
      listHeaderComponent?: React.ReactNode;
    }) =>
      React.createElement(
        View,
        {testID: 'conversation'},
        listHeaderComponent || null,
      ),
    InteractionsBar: () => React.createElement(View, {testID: 'interactions-bar'}),
    CommentInput: () => React.createElement(View, {testID: 'comment-input'}),
    ThreadsBottomSheet: () =>
      React.createElement(View, {testID: 'threads-bottom-sheet'}),
    MessageThreadsBottomSheet: () =>
      React.createElement(View, {testID: 'message-threads-bottom-sheet'}),
    CommentThreadBottomSheet: () =>
      React.createElement(View, {testID: 'comment-thread-bottom-sheet'}),
    ReplyBottomSheet: () =>
      React.createElement(View, {testID: 'reply-bottom-sheet'}),
    ConfirmationModal: () =>
      React.createElement(View, {testID: 'confirmation-modal'}),
  };
});

jest.mock(
  '@/screens/SimulationFeedbackScreen/components/SimulationAudioPlayer/SimulationAudioPlayer',
  () => {
    const React = require('react');
    const {View} = require('react-native');
    return {
      SimulationAudioPlayer: ({audioUrl}: {audioUrl: string}) =>
        React.createElement(View, {
          testID: 'simulation-audio-player',
          accessibilityLabel: audioUrl,
        }),
    };
  },
);

const createMockReviewLogic = (overrides: Record<string, unknown> = {}) =>
  ({
    conversationMessages: [],
    isLoading: false,
    isError: false,
    isFetching: false,
    offset: 0,
    hasMore: false,
    isPrivate: false,
    handleTogglePrivate: jest.fn(),
    comment: '',
    showCommentInput: false,
    isAddingComment: false,
    handleChangeComment: jest.fn(),
    resetCommentInput: jest.fn(),
    handleSendComment: jest.fn(),
    handleSelection: jest.fn(),
    loadMoreMessages: jest.fn(),
    refreshMessages: jest.fn(),
    isThreadsBottomSheetVisible: false,
    closeThreadsBottomSheet: jest.fn(),
    showThreadsBottomSheet: jest.fn(),
    onThreadPress: jest.fn(),
    isCommentThreadBottomSheetVisible: false,
    closeCommentThreadBottomSheet: jest.fn(),
    selectedThreadId: null,
    handleHideCommentThreadBottomSheet: jest.fn(),
    onReplyPress: jest.fn(),
    onReplyPressFromGeneralComments: jest.fn(),
    onReplyPressFromInlineGeneral: jest.fn(),
    handleThreadCommentChange: jest.fn(),
    isReplyBottomSheetVisible: false,
    closeReplyBottomSheet: jest.fn(),
    selectedComment: null,
    setSelectedComment: jest.fn(),
    hideReplyBottomSheet: jest.fn(),
    isMessageThreadsVisible: false,
    handleCloseMessageThreads: jest.fn(),
    selectedMessageForThreads: null,
    selectedMessageContent: null,
    selectedMessageThreads: [],
    handleMessageThreadPress: jest.fn(),
    handleThreadClick: jest.fn(),
    ...overrides,
  }) as unknown as React.ComponentProps<typeof ReviewDetailsLayout>['reviewLogic'];

const defaultProps = {
  reviewId: 'r1',
  reviewLogic: createMockReviewLogic(),
  metadata: undefined,
  onRefreshReactions: jest.fn(),
  renderHeader: () => null,
};

describe('ReviewDetailsLayout', () => {
  beforeEach(() => {
    mockGoBack.mockClear();
  });

  it('shows loading indicator when isLoading', () => {
    const reviewLogic = createMockReviewLogic({isLoading: true});
    const {UNSAFE_getAllByType} = render(
      <ReviewDetailsLayout {...defaultProps} reviewLogic={reviewLogic} />,
    );
    const indicators = UNSAFE_getAllByType(ActivityIndicator);
    expect(indicators.length).toBeGreaterThan(0);
  });

  it('shows error indicator when isError', () => {
    const reviewLogic = createMockReviewLogic({isError: true});
    const {UNSAFE_getAllByType, queryByTestId} = render(
      <ReviewDetailsLayout {...defaultProps} reviewLogic={reviewLogic} />,
    );
    const indicators = UNSAFE_getAllByType(ActivityIndicator);
    expect(indicators.length).toBeGreaterThan(0);
    expect(queryByTestId('back-button')).toBeNull();
  });

  it('renders back button and header when loaded', () => {
    const reviewLogic = createMockReviewLogic();
    const {getByTestId} = render(
      <ReviewDetailsLayout
        {...defaultProps}
        reviewLogic={reviewLogic}
        renderHeader={() => null}
      />,
    );
    expect(getByTestId('back-button')).toBeTruthy();
  });

  it('calls navigation.goBack when back button pressed', () => {
    const reviewLogic = createMockReviewLogic();
    const {getByTestId} = render(
      <ReviewDetailsLayout {...defaultProps} reviewLogic={reviewLogic} />,
    );
    fireEvent.press(getByTestId('back-button'));
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  describe('audio player', () => {
    it('renders audio player when audioUrl is provided', () => {
      const {getByTestId} = render(
        <ReviewDetailsLayout
          {...defaultProps}
          audioUrl="https://example.com/audio.ogg"
        />,
      );
      expect(getByTestId('simulation-audio-player')).toBeTruthy();
    });

    it('does not render audio player when audioUrl is null', () => {
      const {queryByTestId} = render(
        <ReviewDetailsLayout {...defaultProps} audioUrl={null} />,
      );
      expect(queryByTestId('simulation-audio-player')).toBeNull();
    });

    it('does not render audio player when audioUrl is undefined', () => {
      const {queryByTestId} = render(<ReviewDetailsLayout {...defaultProps} />);
      expect(queryByTestId('simulation-audio-player')).toBeNull();
    });
  });
});
