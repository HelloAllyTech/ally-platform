import React from 'react';
import {render, act} from '@testing-library/react-native';

import {Timer} from '../Timer';

describe('Timer', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2023-01-01T00:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('formats and updates elapsed time', () => {
    const startTime = Date.now() - 65 * 1000; // 1m5s ago
    const {getByText} = render(<Timer startTime={startTime} />);

    expect(getByText('00:01:05')).toBeTruthy();

    act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(getByText('00:01:06')).toBeTruthy();
  });
});


