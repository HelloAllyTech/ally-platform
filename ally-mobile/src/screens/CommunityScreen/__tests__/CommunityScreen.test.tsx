import React from 'react';
import {render} from '@testing-library/react-native';
import {Linking} from 'react-native';

import {CommunityScreen} from '../CommunityScreen';

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useFocusEffect: (cb: any) => cb(() => undefined),
  };
});

jest.mock('@/hooks', () => ({
  useTabBackToHomeHandler: () => undefined,
  useAppNavigation: () => ({goBack: jest.fn()}),
}));

describe('CommunityScreen', () => {
  it('opens community URL on focus', () => {
    const spy = jest.spyOn(Linking, 'openURL').mockResolvedValueOnce(true as any);
    render(<CommunityScreen />);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});


