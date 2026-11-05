import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { DiscussionThread } from '../DiscussionThread';

jest.mock('@/services', () => ({
    useGetDiscussionQuery: jest.fn(() => ({
        data: { posts: [], viewer: { canPost: true } },
        isLoading: false,
        isError: false,
    })),
    useCreateDiscussionPostMutation: jest.fn(() => [jest.fn(), { isLoading: false }]),
    useReplyToDiscussionPostMutation: jest.fn(() => [jest.fn(), { isLoading: false }]),
    useEditDiscussionPostMutation: jest.fn(() => [jest.fn(), { isLoading: false }]),
    useDeleteDiscussionPostMutation: jest.fn(() => [jest.fn(), { isLoading: false }]),
    useLockDiscussionPostMutation: jest.fn(() => [jest.fn(), { isLoading: false }]),
    useLockDiscussionMutation: jest.fn(() => [jest.fn(), { isLoading: false }]),
}));

// Mock all hooks from @/hooks
jest.mock('@/hooks', () => ({
    useTranslate: jest.fn(() => ({
        t: (key: string) => key,
    })),
    useTrackPlayerNavigation: jest.fn(),
    useAppNavigation: jest.fn(),
    useBugReport: jest.fn(),
    useDebounce: jest.fn(),
    useDrawerNavigation: jest.fn(),
    useForceUpdate: jest.fn(),
    useGoogleLogin: jest.fn(),
    useHardwareBackPressHandler: jest.fn(),
    useKeyboardState: jest.fn(),
    useProgressSummary: jest.fn(),
    useSession: jest.fn(),
    useSessionChange: jest.fn(),
    useTrackProgress: jest.fn(),
    useUser: jest.fn(),
}));

describe('DiscussionThread', () => {
  it('should render KeyboardAwareScrollView for keyboard management', () => {
    render(
        <DiscussionThread itemId="1" />
    );

    const keyboardAwareScrollView = screen.queryByTestId('keyboard-aware-scroll-view');
    expect(keyboardAwareScrollView).not.toBeNull();
  });
});