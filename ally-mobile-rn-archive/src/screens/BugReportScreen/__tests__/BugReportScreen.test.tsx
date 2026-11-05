import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';

const mockGoBack = jest.fn();
const mockHandleSubmit = jest.fn();
let mockUseBugReportReturn = {
  description: '',
  setDescription: jest.fn(),
  isSubmitting: false,
  canSubmit: false,
  maxLength: 1000,
  handleSubmit: mockHandleSubmit,
};

jest.mock('@/hooks', () => ({
  useAppNavigation: () => ({goBack: mockGoBack}),
  useTranslate: () => ({t: (key: string) => key}),
  useBugReport: (options: {screen?: string; onSuccess?: () => void}) => {
    mockUseBugReportOptions = options;
    return mockUseBugReportReturn;
  },
}));

let mockUseBugReportOptions: {screen?: string; onSuccess?: () => void} = {};

let mockNavigationState: unknown = {
  routes: [{name: 'CallLog'}, {name: 'BugReport'}],
  index: 1,
};

jest.mock('@react-navigation/native', () => ({
  useNavigationState: (selector: (state: unknown) => unknown) =>
    selector(mockNavigationState),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0}),
}));

jest.mock('react-native-size-matters', () => ({
  ScaledSheet: {create: (s: unknown) => s},
  ms: (v: number) => v,
}));

jest.mock('@/assets/icons', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    LeftArrowIcon: () => <View testID="back-arrow" />,
  };
});

jest.mock('@/components', () => {
  const React = require('react');
  const {Text, TouchableOpacity} = require('react-native');
  return {
    Button: ({label, onPress, isDisabled, isLoading, testID}: any) => (
      <TouchableOpacity
        testID={testID}
        onPress={onPress}
        disabled={isDisabled || isLoading}>
        <Text>{isLoading ? 'loading' : label}</Text>
      </TouchableOpacity>
    ),
  };
});

jest.mock('@/theme', () => {
  const handler: ProxyHandler<any> = {
    get: (_t, prop) => {
      if (prop === '__esModule') return false;
      if (typeof prop === 'symbol') return undefined;
      return new Proxy({[Symbol.toPrimitive]: () => '#000'}, handler);
    },
  };
  const p = new Proxy({[Symbol.toPrimitive]: () => '#000'}, handler);
  return {
    __esModule: true,
    colors: p,
    fontFamily: p,
    fontWeights: p,
    typography: p,
    stroke: p,
    default: p,
  };
});

import {BugReportScreen} from '../BugReportScreen';

describe('BugReportScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseBugReportReturn = {
      description: '',
      setDescription: jest.fn(),
      isSubmitting: false,
      canSubmit: false,
      maxLength: 1000,
      handleSubmit: mockHandleSubmit,
    };
    mockNavigationState = {
      routes: [{name: 'CallLog'}, {name: 'BugReport'}],
      index: 1,
    };
  });

  it('renders the title and guided prompt', () => {
    const {getByText} = render(<BugReportScreen />);

    expect(getByText('bugReport.title')).toBeTruthy();
    expect(getByText('bugReport.prompt')).toBeTruthy();
  });

  it('renders the free-text input with a character count', () => {
    const {getByTestId, getByText} = render(<BugReportScreen />);

    expect(getByTestId('bug-report-input')).toBeTruthy();
    expect(getByText('0/1000')).toBeTruthy();
  });

  it('passes the previous route name as screen context to useBugReport', () => {
    render(<BugReportScreen />);

    expect(mockUseBugReportOptions.screen).toBe('CallLog');
  });

  it('resolves the actual screen name when the previous route is nested inside the Drawer/BottomTabs subtree', () => {
    // Mirrors RootNavigator: the root Stack's "CallLog" route hosts the
    // Drawer, which hosts the BottomTabs, which hosts the real screen.
    mockNavigationState = {
      routes: [
        {
          name: 'CallLog',
          state: {
            index: 0,
            routes: [
              {
                name: 'BottomTabs',
                state: {
                  index: 1,
                  routes: [{name: 'CallLog'}, {name: 'Simulations'}],
                },
              },
            ],
          },
        },
        {name: 'BugReport'},
      ],
      index: 1,
    };

    render(<BugReportScreen />);

    expect(mockUseBugReportOptions.screen).toBe('Simulations');
  });

  it('navigates back on back button press', () => {
    const {getByTestId} = render(<BugReportScreen />);

    fireEvent.press(getByTestId('bug-report-back-button'));
    expect(mockGoBack).toHaveBeenCalled();
  });

  it('disables submit while the guided field is empty', () => {
    const {getByTestId, getByText} = render(<BugReportScreen />);

    expect(getByText('bugReport.submit')).toBeTruthy();
    fireEvent.press(getByTestId('bug-report-submit-button'));
    expect(mockHandleSubmit).not.toHaveBeenCalled();
  });

  it('submits when the field has content and canSubmit is true', () => {
    mockUseBugReportReturn = {
      ...mockUseBugReportReturn,
      description: 'The app crashed when I tried to start a call',
      canSubmit: true,
    };
    const {getByTestId} = render(<BugReportScreen />);

    fireEvent.press(getByTestId('bug-report-submit-button'));
    expect(mockHandleSubmit).toHaveBeenCalled();
  });

  it('shows a loading state while submitting', () => {
    mockUseBugReportReturn = {
      ...mockUseBugReportReturn,
      description: 'Something broke',
      canSubmit: true,
      isSubmitting: true,
    };
    const {getByText} = render(<BugReportScreen />);

    expect(getByText('loading')).toBeTruthy();
  });
});
