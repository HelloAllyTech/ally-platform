import React from 'react';
import {Text} from 'react-native';
import {act, render} from '@testing-library/react-native';

import {useCounselorChat} from '../useCounselorChat';

jest.mock('@/services/chatApi', () => ({
  useLazyGetCounsellorChatQuery: () => [jest.fn(async () => ({data: {id: 1}}))],
}));

jest.mock('@/store/hooks', () => ({
  useAppDispatch: () => jest.fn(),
  useAppSelector: (selector: any) => {
    const mockState = {
      user: {
        userData: {isAuthenticated: true, user: {role: 1}},
        permissions: ['VIEW_COUNSELOR_CHAT'], // Provide permissions as array
      },
    };
    return selector(mockState);
  },
}));

jest.mock('@/store/slices/chatSlice', () => ({
  setCurrentChat: (d: any) => ({type: 'set', payload: d}),
  clearCurrentChat: () => ({type: 'clear'}),
}));

jest.mock('@/constants', () => ({
  USER_PERMISSIONS: {VIEW_COUNSELOR_CHAT: 'VIEW_COUNSELOR_CHAT'},
  SCREEN_NAMES: {BREATHING: 'Breathing', CALL_SUMMARY: 'CallSummary', LISTENING: 'Listening', SPLASH: 'Splash'},
}));

const Test = () => {
  const {checkCounselorChat} = useCounselorChat({
    onActiveChatFound: jest.fn(),
    onNoActiveChatFound: jest.fn(),
    shouldSubscribeToAppState: false,
    getCurrentRoute: () => undefined,
  });
  return <Text testID="check" onPress={() => checkCounselorChat()} />;
};

describe('useCounselorChat', () => {
  it('checks for counselor chat without throwing', async () => {
    const {getByTestId} = render(<Test />);
    await act(async () => {
      getByTestId('check').props.onPress();
    });
  });

  it('returns checkCounselorChat function', () => {
    const TestReturn = () => {
      const {checkCounselorChat} = useCounselorChat();
      return <Text testID="exists">{typeof checkCounselorChat}</Text>;
    };

    const {getByText} = render(<TestReturn />);
    expect(getByText('function')).toBeTruthy();
  });

  it('renders component using the hook without errors', () => {
    const TestSimple = () => {
      const {checkCounselorChat} = useCounselorChat({
        shouldSubscribeToAppState: false,
      });
      return <Text testID="simple">{String(!!checkCounselorChat)}</Text>;
    };

    const {getByText} = render(<TestSimple />);
    expect(getByText('true')).toBeTruthy();
  });
});
