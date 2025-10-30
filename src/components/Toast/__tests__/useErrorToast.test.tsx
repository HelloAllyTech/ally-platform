import React from 'react';
import {act, render} from '@testing-library/react-native';

import {ToastProvider, useErrorToast} from '@/components/Toast/ToastProvider';

jest.mock('@/components/Toast/Toast', () => {
  const React = require('react');
  const {Text} = require('react-native');
  return {
    Toast: ({message, type}: any) => React.createElement(Text, {testID: 'toast', accessibilityLabel: type}, message),
  };
});

jest.mock('@/hooks', () => ({
  useTranslate: () => ({t: (k: string) => k}),
}));

const Test: React.FC = () => {
  const {showErrorToast} = useErrorToast();
  return (
    <>
      <></>
      <></>
      <></>
      {/* trigger errors */}
      <></>
      <></>
      <></>
      <></>
      <></>
    </>
  );
};

describe('useErrorToast', () => {
  it('shows translated fallback when error message missing', () => {
    const {queryByTestId, rerender} = render(
      <ToastProvider>
        <Test />
      </ToastProvider>,
    );

    // Re-render with a callback invoking showErrorToast
    const HookInvoker: React.FC = () => {
      const {showErrorToast} = useErrorToast();
      React.useEffect(() => {
        showErrorToast(undefined, 'Errors.generic');
      }, [showErrorToast]);
      return null;
    };

    act(() => {
      rerender(
        <ToastProvider>
          <HookInvoker />
        </ToastProvider>,
      );
    });

    const toast = queryByTestId('toast');
    expect(toast).toBeTruthy();
  });

  it('shows actual error message when present', () => {
    const ErrInvoker: React.FC = () => {
      const {showErrorToast} = useErrorToast();
      React.useEffect(() => {
        showErrorToast(new Error('Boom'), 'Errors.fallback');
      }, [showErrorToast]);
      return null;
    };

    const {getByText} = render(
      <ToastProvider>
        <ErrInvoker />
      </ToastProvider>,
    );

    expect(getByText('Boom')).toBeTruthy();
  });
});


