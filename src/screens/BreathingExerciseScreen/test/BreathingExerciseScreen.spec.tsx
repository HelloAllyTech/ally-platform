import React from 'react';
import {act, fireEvent, render} from '@testing-library/react-native';

import {BreathingExerciseScreen} from '../BreathingExerciseScreen';

const mockGoBack = jest.fn();
const mockStartTrackItem = jest.fn().mockReturnValue({
  unwrap: jest.fn().mockResolvedValue({}),
});

jest.mock('@/services', () => ({
  useStartTrackItemMutation: () => [mockStartTrackItem],
}));

jest.mock('@/hooks', () => ({
  useTranslate: () => ({t: (key: string) => key}),
}));

// Custom mock for reanimated to control animation timing in tests
jest.mock('react-native-reanimated', () => {
  const Reanimated = require('react-native-reanimated/mock');

  Reanimated.withTiming = (toValue: any, config: any, callback: any) => {
    if (callback) {
      // Use a timer to delay the callback so we can test phases
      setTimeout(() => callback(true), config.duration);
    }
    return toValue;
  };
  return Reanimated;
});

const mockConfig = {
  inhale: 4,
  holdIn: 4,
  exhale: 4,
  holdOut: 4,
  cycles: 2,
  inhaleText: 'Inhale through your nose',
  holdInText: 'Hold your breath',
  exhaleText: 'Exhale slowly through your mouth',
  holdOutText: 'Hold and relax',
};

const mockRoute = {
  params: {
    config: mockConfig,
    itemId: 'item-123',
    trackId: 'track-456',
  },
};

const mockNavigation: any = {
  goBack: mockGoBack,
};

describe('BreathingExerciseScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  it('renders correctly and shows initial instruction', () => {
    const {getByText, getByTestId} = render(
      <BreathingExerciseScreen
        navigation={mockNavigation}
        route={mockRoute as any}
      />,
    );

    expect(getByText('Inhale through your nose')).toBeTruthy();
    expect(getByTestId('breathing-square')).toBeTruthy();
    expect(getByTestId('breathing-dot')).toBeTruthy();
    expect(getByText('Exit')).toBeTruthy();
  });

  it('navigates back and marks complete when Exit is clicked', async () => {
    const {getByText} = render(
      <BreathingExerciseScreen
        navigation={mockNavigation}
        route={mockRoute as any}
      />,
    );

    const exitButton = getByText('Exit');
    await act(async () => {
      fireEvent.press(exitButton);
    });

    expect(mockStartTrackItem).toHaveBeenCalledWith({itemId: 'item-123'});
    expect(mockGoBack).toHaveBeenCalled();
  });

  it('cycles through breathing phases', () => {
    const {getByText} = render(
      <BreathingExerciseScreen
        navigation={mockNavigation}
        route={mockRoute as any}
      />,
    );

    // Initial: Inhale
    expect(getByText('Inhale through your nose')).toBeTruthy();

    // Advance to Hold In
    act(() => {
      jest.advanceTimersByTime(4001); // inhale duration + a bit
    });
    expect(getByText('Hold your breath')).toBeTruthy();

    // Advance to Exhale
    act(() => {
      jest.advanceTimersByTime(4001); // holdIn duration
    });
    expect(getByText('Exhale slowly through your mouth')).toBeTruthy();

    // Advance to Hold Out
    act(() => {
      jest.advanceTimersByTime(4001); // exhale duration
    });
    expect(getByText('Hold and relax')).toBeTruthy();

    // Advance to next cycle Inhale
    act(() => {
      jest.advanceTimersByTime(4001); // holdOut duration
    });
    expect(getByText('Inhale through your nose')).toBeTruthy();
    expect(getByText('Cycle 2 of 2')).toBeTruthy();
  });
});
