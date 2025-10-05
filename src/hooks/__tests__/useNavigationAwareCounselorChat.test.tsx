import React from 'react';
import {NavigationContainerRef} from '@react-navigation/native';
import {Text} from 'react-native';
import {render} from '@testing-library/react-native';

import {useNavigationAwareCounselorChat} from '../useNavigationAwareCounselorChat';

jest.mock('../useAppNavigation', () => ({
  useAppNavigation: () => ({reset: jest.fn(), navigate: jest.fn()}),
}));

jest.mock('../useCounselorChat', () => ({
  useCounselorChat: jest.fn(() => ({checkCounselorChat: jest.fn()})),
}));

describe('useNavigationAwareCounselorChat', () => {
  it('subscribes to nav state and composes useCounselorChat', () => {
    const ref: any = {
      addListener: jest.fn(() => jest.fn()),
      getCurrentRoute: jest.fn(() => ({name: 'CALL_LOG'})),
    } satisfies Partial<NavigationContainerRef<any>>;

    const Test = () => {
      useNavigationAwareCounselorChat(ref);
      return <Text>ok</Text>;
    };

    render(<Test />);
  });
});


