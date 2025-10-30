import React from 'react';
import {render, fireEvent, act} from '@testing-library/react-native';
import {AppState} from 'react-native';

import {BreathingScreen} from '../BreathingScreen';

jest.useFakeTimers();

try { jest.mock('react-native/Libraries/DevMenu/DevMenu', () => ({})); } catch {}
try { jest.mock('react-native/src/private/devmenu/DevMenu', () => ({})); } catch {}

jest.mock('react-native-linear-gradient', () => 'LinearGradient');
jest.mock('lottie-react-native', () => 'LottieView');

jest.mock('@/hooks', () => {
  const handlerRef: {cb?: () => boolean} = {};
  return {
    useTranslate: () => ({t: (k: string) => k}),
    useHardwareBackPressHandler: (cb: () => boolean) => {
      handlerRef.cb = cb;
      return undefined;
    },
    __handlerRef: handlerRef,
  };
});

jest.mock('@/assets', () => ({breathingBackground: 1}));

jest.mock('@/store/hooks', () => ({useAppDispatch: () => jest.fn()}));

jest.mock('@/constants', () => ({
  isIOS: false,
  SCREEN_NAMES: {CALL_LOG: 'CallLog', CALL_SUMMARY: 'CallSummary'},
}));

jest.mock('../components/CallEndOverlay/CallEndOverlay', () => ({
  CallEndOverlay: () => {
    const React = require('react');
    const {Text} = require('react-native');
    return <Text>overlay</Text>;
  },
}));

jest.mock('../components/BreathingVideo/BoxBreathingAnimation', () => ({
  BoxBreathingAnimation: ({onPhaseChange}: any) => {
    const React = require('react');
    const {TouchableOpacity, Text} = require('react-native');
    return (
      <TouchableOpacity testID="trigger-phase" onPress={() => onPhaseChange({} as any)}>
        <Text>anim</Text>
      </TouchableOpacity>
    );
  },
}));

jest.mock('../components/BreathingVideo/BreathingControls', () => ({
  BreathingControls: ({onToggleMute, onTogglePlayPause}: any) => {
    const React = require('react');
    const {TouchableOpacity, Text, View} = require('react-native');
    return (
      <View>
        <TouchableOpacity testID="toggle-mute" onPress={onToggleMute}>
          <Text>mute</Text>
        </TouchableOpacity>
        <TouchableOpacity testID="toggle-play" onPress={onTogglePlayPause}>
          <Text>play</Text>
        </TouchableOpacity>
      </View>
    );
  },
}));

jest.mock('@/components', () => ({
  PrimaryButton: ({onPress}: any) => {
    const React = require('react');
    const {TouchableOpacity, Text} = require('react-native');
    return (
      <TouchableOpacity testID="view-summary" onPress={onPress}>
        <Text>view summary</Text>
      </TouchableOpacity>
    );
  },
}));

describe('BreathingScreen behavior', () => {
  beforeEach(() => {
    jest.spyOn(AppState, 'addEventListener').mockReturnValue({remove: jest.fn()} as any);
  });
  it('hides overlay after timeout and shows animation', async () => {
    const navigation: any = {navigate: jest.fn(), reset: jest.fn()};
    const {getByText, queryByText} = render(
      <BreathingScreen navigation={navigation} route={{} as any} />,
    );
    expect(getByText('overlay')).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(3000);
    });
    expect(queryByText('overlay')).toBeNull();
    expect(getByText('anim')).toBeTruthy();
  });

  it('navigates to summary on button press', async () => {
    const navigation: any = {navigate: jest.fn(), reset: jest.fn()};
    const {getByText, getByTestId} = render(
      <BreathingScreen navigation={navigation} route={{} as any} />,
    );
    await act(async () => {
      jest.advanceTimersByTime(3000);
    });
    fireEvent.press(getByTestId('view-summary'));
    expect(navigation.navigate).toHaveBeenCalledWith('CallSummary');
  });

  it('increments timer on phase change when playing', async () => {
    const navigation: any = {navigate: jest.fn(), reset: jest.fn()};
    const {getByText, getByTestId} = render(
      <BreathingScreen navigation={navigation} route={{} as any} />,
    );
    await act(async () => {
      jest.advanceTimersByTime(3000);
    });
    // initial seconds shows 1
    expect(getByText('1')).toBeTruthy();
    fireEvent.press(getByTestId('trigger-phase'));
    await act(async () => {
      jest.advanceTimersByTime(1100);
    });
    expect(getByText('2')).toBeTruthy();
  });

  it('handles back press by resetting navigation', async () => {
    const navigation: any = {navigate: jest.fn(), reset: jest.fn()};
    const hooks = require('@/hooks');
    render(
      <BreathingScreen navigation={navigation} route={{} as any} />,
    );
    // invoke stored back handler
    const cb = hooks.__handlerRef.cb as () => boolean;
    expect(typeof cb).toBe('function');
    const handled = cb();
    expect(handled).toBe(true);
    expect(navigation.reset).toHaveBeenCalled();
  });
});


