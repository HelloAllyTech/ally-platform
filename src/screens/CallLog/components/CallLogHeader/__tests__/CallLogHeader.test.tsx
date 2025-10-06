import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';
import {TouchableOpacity} from 'react-native';

import {CallLogHeader} from '@/screens/CallLog/components/CallLogHeader/CallLogHeader';

jest.mock('@/assets/icons', () => ({ DrawerMenuIcon: () => null, ReplayIcon: () => null }));
jest.mock('@/constants/general', () => ({ isIOS: false }));

jest.mock('@/hooks', () => {
  const mockOpenDrawer = jest.fn();
  return {
    useTranslate: () => ({ t: (k: string) => k }),
    useDrawerNavigation: () => ({ openDrawer: mockOpenDrawer }),
    mockOpenDrawer,
  };
});

describe('CallLogHeader', () => {
  it('opens drawer on hamburger press', () => {
    const {UNSAFE_getAllByType} = render(
      <CallLogHeader search="" onSearchChange={() => {}} />,
    );
    const buttons = UNSAFE_getAllByType(TouchableOpacity);
    fireEvent.press(buttons[0]);
    const {mockOpenDrawer} = require('@/hooks');
    expect(mockOpenDrawer).toHaveBeenCalled();
  });

  it('calls onRefresh when refresh is pressed', () => {
    const onRefresh = jest.fn();
    const {getByLabelText} = render(
      <CallLogHeader search="" onSearchChange={() => {}} onRefresh={onRefresh} isFetching={false} />,
    );
    fireEvent.press(getByLabelText('Refresh'));
    expect(onRefresh).toHaveBeenCalled();
  });
});
