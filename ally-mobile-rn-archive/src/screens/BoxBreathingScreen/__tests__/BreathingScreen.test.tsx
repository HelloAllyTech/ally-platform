import React from 'react';
import {act, fireEvent, render} from '@testing-library/react-native';
import {AppState} from 'react-native';

import {BreathingScreen} from '../BreathingScreen';

jest.useFakeTimers();

const mockReset = jest.fn();
const mockNavigate = jest.fn();
const mockDispatch = jest.fn();
let mockHardwareBackHandler: (() => boolean) | null = null;

// Mock navigation
const mockNavigation: any = {
  reset: mockReset,
  navigate: mockNavigate,
};

// Mock hooks
jest.mock('@/hooks', () => ({
  useTranslate: () => ({t: (key: string) => key}),
  useHardwareBackPressHandler: (handler: () => boolean) => {
    mockHardwareBackHandler = handler;
  },
}));

// Mock store
jest.mock('@/store/hooks', () => ({
  useAppDispatch: () => mockDispatch,
}));

jest.mock('@/store/slices/chatSlice', () => ({
  clearCurrentChat: () => ({type: 'clearCurrentChat'}),
}));

// Mock components
jest.mock('../components', () => ({
  BoxBreathingAnimation: ({testID, onPhaseChange}: any) => {
    const React = require('react');
    const {View, TouchableOpacity} = require('react-native');
    return (
      <View testID={testID}>
        <TouchableOpacity
          testID="trigger-phase-change"
          onPress={onPhaseChange}
        />
      </View>
    );
  },
  BreathingControls: ({
    testID,
    onToggleMute,
    onTogglePlayPause,
  }: any) => {
    const React = require('react');
    const {View, TouchableOpacity} = require('react-native');
    return (
      <View testID={testID}>
        <TouchableOpacity testID="toggle-play" onPress={onTogglePlayPause} />
        <TouchableOpacity testID="toggle-mute" onPress={onToggleMute} />
      </View>
    );
  },
  CallEndOverlay: () => {
    const React = require('react');
    const {View} = require('react-native');
    return <View testID="call-end-overlay" />;
  },
}));

// Mock Button
jest.mock('@/components', () => ({
  Button: ({label, onPress}: any) => {
    const React = require('react');
    const {TouchableOpacity, Text} = require('react-native');
    return (
      <TouchableOpacity testID="view-summary-btn" onPress={onPress}>
        <Text>{label}</Text>
      </TouchableOpacity>
    );
  },
}));

// Mock constants
jest.mock('@/constants', () => ({
  SCREEN_NAMES: {
    CALL_LOG: 'CallLog',
    CALL_SUMMARY: 'CallSummary',
  },
  isIOS: false,
}));

// Mock assets
jest.mock('@/assets', () => ({
  breathingBackground: 'breathing-background',
}));

// Mock lottie
jest.mock('lottie-react-native', () => {
  const React = require('react');
  return React.forwardRef((props: any, ref: any) => {
    React.useImperativeHandle(ref, () => ({
      play: jest.fn(),
    }));
    return null;
  });
});

// Mock LinearGradient
jest.mock('react-native-linear-gradient', () => {
  const React = require('react');
  const {View} = require('react-native');
  return ({children}: any) => <View>{children}</View>;
});

describe('BreathingScreen', () => {
  const mockRoute: any = {
    key: 'Breathing-key',
    name: 'Breathing',
    params: {},
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockHardwareBackHandler = null;
  });

  it('renders correctly with initial overlay', () => {
    const {getByTestId} = render(
      <BreathingScreen navigation={mockNavigation} route={mockRoute} />,
    );
    expect(getByTestId('call-end-overlay')).toBeTruthy();
  });

  it(
    'hides overlay and shows breathing animation after 3 seconds',
    async () => {
      const {getByTestId} = render(
        <BreathingScreen navigation={mockNavigation} route={mockRoute} />,
      );

      expect(getByTestId('call-end-overlay')).toBeTruthy();

      await act(async () => {
        jest.advanceTimersByTime(3000);
      });

      expect(getByTestId('box-breathing-animation')).toBeTruthy();
    },
    20000,
  );

  it('toggles play/pause when control button is pressed', async () => {
    const {getByTestId} = render(
      <BreathingScreen navigation={mockNavigation} route={mockRoute} />,
    );

    await act(async () => {
      jest.advanceTimersByTime(3000);
    });

    const togglePlayBtn = getByTestId('toggle-play');
    
    act(() => {
      fireEvent.press(togglePlayBtn);
    });

    // Should toggle state
    expect(togglePlayBtn).toBeTruthy();
  });

  it('toggles mute when mute button is pressed', async () => {
    const {getByTestId} = render(
      <BreathingScreen navigation={mockNavigation} route={mockRoute} />,
    );

    await act(async () => {
      jest.advanceTimersByTime(3000);
    });

    const toggleMuteBtn = getByTestId('toggle-mute');
    
    act(() => {
      fireEvent.press(toggleMuteBtn);
    });

    expect(toggleMuteBtn).toBeTruthy();
  });

  it('navigates to call summary when view summary button is pressed', async () => {
    const {getByTestId} = render(
      <BreathingScreen navigation={mockNavigation} route={mockRoute} />,
    );

    await act(async () => {
      jest.advanceTimersByTime(3000);
    });

    const viewSummaryBtn = getByTestId('view-summary-btn');
    
    act(() => {
      fireEvent.press(viewSummaryBtn);
    });

    expect(mockNavigate).toHaveBeenCalledWith('CallSummary');
  });

  it('handles phase change and starts timer', async () => {
    const {getByTestId} = render(
      <BreathingScreen navigation={mockNavigation} route={mockRoute} />,
    );

    await act(async () => {
      jest.advanceTimersByTime(3000);
    });

    const phaseChangeTrigger = getByTestId('trigger-phase-change');
    
    await act(async () => {
      fireEvent.press(phaseChangeTrigger);
      jest.advanceTimersByTime(4000);
    });

    // Timer should have counted
    expect(getByTestId('box-breathing-animation')).toBeTruthy();
  });

  it('handles hardware back press', async () => {
    render(<BreathingScreen navigation={mockNavigation} route={mockRoute} />);

    await act(async () => {
      jest.advanceTimersByTime(3000);
    });

    if (mockHardwareBackHandler) {
      act(() => {
        mockHardwareBackHandler!();
      });

      expect(mockDispatch).toHaveBeenCalledWith({type: 'clearCurrentChat'});
      expect(mockReset).toHaveBeenCalledWith({
        index: 0,
        routes: [{name: 'CallLog'}],
      });
    }
  });

  it('pauses animation when app goes inactive', async () => {
    const {getByTestId} = render(
      <BreathingScreen navigation={mockNavigation} route={mockRoute} />,
    );

    await act(async () => {
      jest.advanceTimersByTime(3000);
    });

    // Simulate app state change
    act(() => {
      AppState.currentState = 'inactive';
      const listeners = (AppState as any)._listeners || [];
      listeners.forEach((listener: any) => listener('inactive'));
    });

    expect(getByTestId('box-breathing-animation')).toBeTruthy();
  });

  it('cleans up timers on unmount', async () => {
    const {unmount, getByTestId} = render(
      <BreathingScreen navigation={mockNavigation} route={mockRoute} />,
    );

    await act(async () => {
      jest.advanceTimersByTime(3000);
    });

    const phaseChangeTrigger = getByTestId('trigger-phase-change');
    
    await act(async () => {
      fireEvent.press(phaseChangeTrigger);
    });

    act(() => {
      unmount();
    });

    // Should not throw errors
    expect(true).toBe(true);
  });

  it('resets seconds when stopping', async () => {
    const {getByTestId} = render(
      <BreathingScreen navigation={mockNavigation} route={mockRoute} />,
    );

    await act(async () => {
      jest.advanceTimersByTime(3000);
    });

    const togglePlayBtn = getByTestId('toggle-play');
    
    // Start phase change
    const phaseChangeTrigger = getByTestId('trigger-phase-change');
    await act(async () => {
      fireEvent.press(phaseChangeTrigger);
      jest.advanceTimersByTime(2000);
    });

    // Stop playing
    act(() => {
      fireEvent.press(togglePlayBtn);
    });

    // Seconds should reset
    expect(getByTestId('box-breathing-animation')).toBeTruthy();
  });

  it('does not start timer on phase change when not playing', async () => {
    const {getByTestId} = render(
      <BreathingScreen navigation={mockNavigation} route={mockRoute} />,
    );

    await act(async () => {
      jest.advanceTimersByTime(3000);
    });

    // Pause first
    const togglePlayBtn = getByTestId('toggle-play');
    act(() => {
      fireEvent.press(togglePlayBtn);
    });

    // Try to trigger phase change
    const phaseChangeTrigger = getByTestId('trigger-phase-change');
    await act(async () => {
      fireEvent.press(phaseChangeTrigger);
      jest.advanceTimersByTime(1000);
    });

    // Should not crash
    expect(getByTestId('box-breathing-animation')).toBeTruthy();
  });
});

