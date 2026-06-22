import React from 'react';
import {act, fireEvent, render, waitFor} from '@testing-library/react-native';

import {RetrySessionModal} from '../RetrySessionModal';

jest.mock('@/hooks', () => ({
  useTranslate: () => ({t: (key: string) => key}),
}));

jest.mock('@/assets', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    CloseIcon: () => <View testID="close-icon" />,
    RetrySessionIcon: () => <View testID="retry-session-icon" />,
  };
});

jest.mock('@/components', () => {
  const React = require('react');
  const {TouchableOpacity, Text} = require('react-native');
  return {
    Button: ({label, onPress, isDisabled, isLoading}: any) => (
      <TouchableOpacity
        testID="retry-button"
        onPress={onPress}
        disabled={isDisabled}>
        <Text>{isLoading ? 'Loading...' : label}</Text>
      </TouchableOpacity>
    ),
  };
});

jest.mock('react-native-size-matters', () => ({
  ScaledSheet: {create: (s: unknown) => s},
}));

jest.mock('@/theme', () => ({
  colors: {blackTransparent50: 'rgba(0,0,0,0.5)', white: '#fff', darkGray12: '#333', darkGray2: '#666', darkGray16: '#888'},
  fontFamily: {REPLAY_PRO: {HEADLINE: {}, BOLD_ITALIC: {}}, IBM_PLEX_SERIF: {REGULAR: {}}},
  fontWeights: {medium: '500', regular: '400'},
  typography: {body: {large: {}, small: {}, tiny: {}}},
}));

describe('RetrySessionModal', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns null when not visible', () => {
    const {toJSON} = render(
      <RetrySessionModal
        visible={false}
        onClose={jest.fn()}
        onRetry={jest.fn().mockResolvedValue(true)}
      />,
    );
    expect(toJSON()).toBeNull();
  });

  it('renders title, subtitle, description, and retry button when visible', () => {
    const {getByText} = render(
      <RetrySessionModal
        visible={true}
        onClose={jest.fn()}
        onRetry={jest.fn().mockResolvedValue(true)}
      />,
    );

    expect(getByText('common.maxActiveUsers.title')).toBeTruthy();
    expect(
      getByText(/common.maxActiveUsers.autoRetry/),
    ).toBeTruthy();
    expect(getByText('common.maxActiveUsers.description')).toBeTruthy();
    expect(getByText('common.retry')).toBeTruthy();
  });

  it('shows auto-retry description text with countdown', () => {
    const {getByText} = render(
      <RetrySessionModal
        visible={true}
        onClose={jest.fn()}
        onRetry={jest.fn().mockResolvedValue(true)}
      />,
    );

    expect(
      getByText(/common\.maxActiveUsers\.autoRetry/),
    ).toBeTruthy();
  });

  it('calls onClose when close button is pressed', () => {
    const onClose = jest.fn();
    const {getByTestId} = render(
      <RetrySessionModal
        visible={true}
        onClose={onClose}
        onRetry={jest.fn().mockResolvedValue(true)}
      />,
    );

    const closeButtons = getByTestId('close-icon').parent;
    if (closeButtons) {
      fireEvent.press(closeButtons);
    }
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onRetry when retry button is pressed', async () => {
    const onRetry = jest.fn().mockResolvedValue(true);
    const {getByTestId} = render(
      <RetrySessionModal
        visible={true}
        onClose={jest.fn()}
        onRetry={onRetry}
      />,
    );

    await act(async () => {
      fireEvent.press(getByTestId('retry-button'));
    });

    expect(onRetry).toHaveBeenCalled();
  });

  it('switches to cooldown status when onRetry returns false', async () => {
    const onRetry = jest.fn().mockResolvedValue(false);
    const {getByTestId, getByText} = render(
      <RetrySessionModal
        visible={true}
        onClose={jest.fn()}
        onRetry={onRetry}
      />,
    );

    await act(async () => {
      fireEvent.press(getByTestId('retry-button'));
    });

    expect(
      getByText(/common\.maxActiveUsers\.manualRetry/),
    ).toBeTruthy();
  });

  it('disables retry button during cooldown', async () => {
    const onRetry = jest.fn().mockResolvedValue(false);
    const {getByTestId} = render(
      <RetrySessionModal
        visible={true}
        onClose={jest.fn()}
        onRetry={onRetry}
      />,
    );

    await act(async () => {
      fireEvent.press(getByTestId('retry-button'));
    });

    const btn = getByTestId('retry-button');
    const isDisabled =
      btn.props.disabled ??
      btn.props.accessibilityState?.disabled;
    expect(isDisabled).toBeTruthy();
  });

  it('resets state when visibility changes to false', async () => {
    const {rerender, toJSON} = render(
      <RetrySessionModal
        visible={true}
        onClose={jest.fn()}
        onRetry={jest.fn().mockResolvedValue(true)}
      />,
    );

    rerender(
      <RetrySessionModal
        visible={false}
        onClose={jest.fn()}
        onRetry={jest.fn().mockResolvedValue(true)}
      />,
    );

    expect(toJSON()).toBeNull();
  });

  it('renders RetrySessionIcon', () => {
    const {getByTestId} = render(
      <RetrySessionModal
        visible={true}
        onClose={jest.fn()}
        onRetry={jest.fn().mockResolvedValue(true)}
      />,
    );

    expect(getByTestId('retry-session-icon')).toBeTruthy();
  });
});
