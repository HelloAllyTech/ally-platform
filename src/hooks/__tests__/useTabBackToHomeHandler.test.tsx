import React from 'react';
import {Text} from 'react-native';
import {render} from '@testing-library/react-native';

// Mock the hooks barrel to avoid importing other hooks/components/services and capture back handler
const mockNav = { navigate: jest.fn() };
let mockCapturedBackHandler: (() => boolean) | null = null;
jest.mock('@/hooks', () => ({
  useAppNavigation: () => mockNav,
  useHardwareBackPressHandler: (cb: any) => {
    mockCapturedBackHandler = cb;
    return cb;
  },
}));

// Provide a controllable focus mock
let mockIsFocusedState = true;
jest.mock('@react-navigation/native', () => ({ useIsFocused: jest.fn(() => mockIsFocusedState) }));

// Prevent native module import chain caused via components barrel indirectly
jest.mock('react-native-network-logger', () => ({
  __esModule: true,
  default: () => null,
  startNetworkLogging: jest.fn(),
  stopNetworkLogging: jest.fn(),
}));

import {useTabBackToHomeHandler} from '../useTabBackToHomeHandler';

describe('useTabBackToHomeHandler', () => {
  beforeEach(() => {
    mockNav.navigate.mockClear();
    mockCapturedBackHandler = null;
    mockIsFocusedState = true;
  });

  const Test = () => { useTabBackToHomeHandler(); return <Text>ok</Text>; };

  it('navigates to CALL_LOG when focused and back pressed', () => {
    render(<Test />);
    expect(typeof mockCapturedBackHandler).toBe('function');
    const handled = mockCapturedBackHandler && mockCapturedBackHandler();
    expect(mockNav.navigate).toHaveBeenCalled();
    expect(handled).toBe(true);
  });

  it('does not handle back when not focused', () => {
    mockIsFocusedState = false;
    render(<Test />);
    const handled = mockCapturedBackHandler && mockCapturedBackHandler();
    expect(mockNav.navigate).not.toHaveBeenCalled();
    expect(handled).toBe(false);
  });
});
