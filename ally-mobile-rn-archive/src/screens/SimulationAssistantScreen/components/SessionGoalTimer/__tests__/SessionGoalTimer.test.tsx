jest.mock('react-i18next', () => {
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
  return {
    ...jest.requireActual('react-i18next'),
    useTranslation: () => ({
      t: resolve,
      i18n: {language: 'en', changeLanguage: jest.fn()},
    }),
  };
});

import React from 'react';
import { render, act } from '@testing-library/react-native';
import { SessionGoalTimer } from '../SessionGoalTimer';

jest.mock('react-native-linear-gradient', () => 'LinearGradient');

describe('SessionGoalTimer', () => {
  const defaultProps = {
    startTime: new Date('2024-01-01T10:00:00Z'),
    maxTimeValue: '00:30:00', // 30 minutes in seconds = 1800
  };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2024-01-01T10:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders correctly with initial props', () => {
    const { getByTestId, getByText } = render(
      <SessionGoalTimer {...defaultProps} />
    );

    expect(getByTestId('session-goal-timer')).toBeTruthy();
    expect(getByTestId('session-goal-timer-label')).toBeTruthy();
    // 30:00
    expect(getByText('30:00')).toBeTruthy();
    // Initial remaining time: 30 minutes
    expect(getByText('30 min 0 sec')).toBeTruthy();
  });

  it('updates remaining time correctly after 5 minutes', () => {
    const { getByText } = render(<SessionGoalTimer {...defaultProps} />);

    // Advance time by 5 minutes (300 seconds)
    // 30 - 5 = 25 minutes remaining
    act(() => {
      jest.advanceTimersByTime(5 * 60 * 1000);
    });

    expect(getByText('25 min 0 sec')).toBeTruthy();
  });

  it('shows red colors when time remaining is <= 60 seconds', () => {
    // 30 minutes total. 
    // Advance time by 29 minutes and 10 seconds -> 50 seconds remaining
    const { getByText, getByTestId } = render(<SessionGoalTimer {...defaultProps} />);

    act(() => {
      jest.advanceTimersByTime((29 * 60 + 10) * 1000);
    });

    // 0 min 50 sec
    expect(getByText('0 min 50 sec')).toBeTruthy();

    const remainingText = getByTestId('session-goal-timer-remaining');
    // Check style for red color #ef4444
    expect(remainingText.props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ color: '#ef4444' })
      ])
    );
  });

  it('shows orange colors when time remaining is <= 300 seconds (5 mins) but > 60 seconds', () => {
    // 30 mins total. 
    // Advance by 26 minutes -> 4 minutes remaining (240 seconds)
    const { getByText, getByTestId } = render(<SessionGoalTimer {...defaultProps} />);

    act(() => {
      jest.advanceTimersByTime(26 * 60 * 1000);
    });

    expect(getByText('4 min 0 sec')).toBeTruthy();

    const remainingText = getByTestId('session-goal-timer-remaining');
    // Check style for orange color #E77625
    expect(remainingText.props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ color: '#E77625' })
      ])
    );
  });

  it('shows green/slate colors when time remaining is > 300 seconds', () => {
     // 30 mins total. Advance by 1 minute -> 29 mins remaining
    const { getByText, getByTestId } = render(<SessionGoalTimer {...defaultProps} />);

    act(() => {
      jest.advanceTimersByTime(60 * 1000);
    });

    expect(getByText('29 min 0 sec')).toBeTruthy();

    const remainingText = getByTestId('session-goal-timer-remaining');
    // Check style - logic: remainingTime > 300 -> #4ade80 (green) or #cbd5e1 if 0?
    // In component:
    // if remainingTime > 0
    //   if <= 300 -> ...
    //   else -> #4ade80
    expect(remainingText.props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ color: '#4ade80' })
      ])
    );
  });

  it('handles zero remaining time correctly', () => {
    const { getByText, getByTestId } = render(<SessionGoalTimer {...defaultProps} />);

    act(() => {
      jest.advanceTimersByTime(31 * 60 * 1000); // Past max time
    });

    expect(getByText('0 min 0 sec')).toBeTruthy();

    const remainingText = getByTestId('session-goal-timer-remaining');
    // In component: if remainingTime > 0 ... else return '#cbd5e1'
    expect(remainingText.props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ color: '#cbd5e1' })
      ])
    );
  });

  it('formats HH:MM:SS correctly', () => {
     // Pass a time > 1 hour, e.g. 01:30:00
     const props = {
        startTime: new Date('2024-01-01T10:00:00Z'),
        maxTimeValue: '01:30:00', 
     };
     const { getByTestId, getByText } = render(<SessionGoalTimer {...props} />);
     
     // Should format 01:30:00 as "01:30:00"
     expect(getByText('01:30:00')).toBeTruthy();
     // Remaining text 90 min 0 sec initially
     expect(getByText('90 min 0 sec')).toBeTruthy();
  });
});
