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
});


