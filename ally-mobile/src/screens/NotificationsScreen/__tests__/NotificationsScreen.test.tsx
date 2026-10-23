import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';

import {NotificationsScreen} from '../NotificationsScreen';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0}),
}));

const mockPush = jest.fn();
const mockGoBack = jest.fn();

jest.mock('@/hooks', () => ({
  useAppNavigation: jest.fn(() => ({
    navigate: jest.fn(),
    push: mockPush,
    goBack: mockGoBack,
  })),
  useHardwareBackPressHandler: jest.fn(),
}));

const mockMarkRead = jest.fn();
const mockMarkAllRead = jest.fn();

let mockNotifications: any[] = [];

jest.mock('@/services/notificationsApi', () => ({
  useGetNotificationsQuery: jest.fn(() => ({
    data: {data: mockNotifications, count: mockNotifications.length},
    isLoading: false,
    isFetching: false,
    refetch: jest.fn(),
  })),
  useMarkNotificationReadMutation: jest.fn(() => [mockMarkRead]),
  useMarkAllNotificationsReadMutation: jest.fn(() => [mockMarkAllRead]),
}));

describe('NotificationsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('pushes the course item player on a COURSE_DISCUSSION_REPLY tap', () => {
    mockNotifications = [
      {
        id: 'notif-1',
        type: 'COURSE_DISCUSSION_REPLY',
        title: 'New reply to your post',
        body: 'Asha replied to your post in "Active Listening"',
        data: {
          screen: 'CourseDiscussion',
          trackId: 'track-1',
          itemId: 'item-1',
          postId: 'post-2',
        },
        readAt: null,
        createdAt: new Date().toISOString(),
      },
    ];

    const {getByTestId} = render(<NotificationsScreen />);
    fireEvent.press(getByTestId('notification-item'));

    expect(mockMarkRead).toHaveBeenCalledWith('notif-1');
    expect(mockPush).toHaveBeenCalledWith('CourseItemPlayer', {
      trackId: 'track-1',
      itemId: 'item-1',
      highlightPostId: 'post-2',
    });
  });

  it('does not navigate for a notification of another type', () => {
    mockNotifications = [
      {
        id: 'notif-2',
        type: 'ENGAGEMENT_REMINDER',
        title: 'Come back',
        body: 'Practice makes perfect',
        data: null,
        readAt: null,
        createdAt: new Date().toISOString(),
      },
    ];

    const {getByTestId} = render(<NotificationsScreen />);
    fireEvent.press(getByTestId('notification-item'));

    expect(mockPush).not.toHaveBeenCalled();
  });
});
