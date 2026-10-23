import React from 'react';
import {act, render} from '@testing-library/react-native';

import {ToastProvider, showToast as showGlobalToast, hideToast as hideGlobalToast} from '@/components/Toast/ToastProvider';

jest.mock('@/components/Toast/Toast', () => {
  const React = require('react');
  const {Text} = require('react-native');
  return {
    Toast: ({message}: any) => React.createElement(Text, null, message),
  };
});

jest.mock('@/hooks', () => ({
  useTranslate: () => ({ t: (k: string) => k }),
}));

describe('ToastProvider', () => {
  it('shows and hides toast via imperative API', () => {
    const {queryByText} = render(
      <ToastProvider>
        <></>
      </ToastProvider>,
    );

    act(() => {
      showGlobalToast('Hi');
    });
    expect(queryByText('Hi')).toBeTruthy();

    act(() => {
      hideGlobalToast();
    });
    expect(queryByText('Hi')).toBeNull();
  });
});
