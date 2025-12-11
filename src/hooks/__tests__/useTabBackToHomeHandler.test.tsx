import React from 'react';
import {Text} from 'react-native';
import {render} from '@testing-library/react-native';

// Mock the navigation tab helper
jest.mock('@/navigation/TabNavigator', () => ({
  getFirstVisibleTab: () => 'CallLog',
}));

// Mock Redux parts
jest.mock('react-redux', () => ({
  useSelector: (fn: any) => fn({ user: { permissions: ['VIEW_CALL_LOGS'] } }),
}));

// Mock the store so barrel file resolution does not crash
jest.mock('@/store/store', () => ({ AppRootState: {} }));

import {useTabBackToHomeHandler} from '../useTabBackToHomeHandler';

// Mock navigation
const mockNav = { navigate: jest.fn() };
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNav,
  useIsFocused: jest.fn(() => mockIsFocusedState),
}));

let mockIsFocusedState = true;
let mockCapturedBackHandler: (() => boolean) | null = null;

// Mock hooks barrel to avoid heavy imports
jest.mock('@/hooks', () => ({
  useHardwareBackPressHandler: (cb: any) => {
    mockCapturedBackHandler = cb;
    return cb;
  },
}));

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
