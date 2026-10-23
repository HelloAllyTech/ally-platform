import React from 'react';
import {act, render} from '@testing-library/react-native';

import {Toast} from '@/components/Toast';

jest.useFakeTimers();

describe('Toast', () => {
  it('renders message', () => {
    const {getByText} = render(<Toast message="Hello" />);
    expect(getByText('Hello')).toBeTruthy();
  });

  it('calls onHide after duration', () => {
    const onHide = jest.fn();
    render(<Toast message="Bye" duration={500} onHide={onHide} />);
    act(() => {
      jest.advanceTimersByTime(600);
    });
    expect(onHide).toHaveBeenCalled();
  });
});
