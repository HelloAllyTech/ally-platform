import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';

import {TabView} from '@/screens/CallLog/components/TabView/TabView';

jest.mock('@/hooks', () => ({
  useTranslate: () => ({ t: (k: string) => k }),
}));

jest.mock('@/constants', () => ({
  LogType: { REAL: 'REAL', SIMULATION: 'SIMULATION' },
}));

describe('TabView', () => {
  it('calls onTabChange when a tab is pressed', () => {
    const onTabChange = jest.fn();
    const {getByText} = render(
      <TabView activeTab={(require('@/constants').LogType as any).REAL} onTabChange={onTabChange} />,
    );

    fireEvent.press(getByText('CallLogs.simulations'));
    expect(onTabChange).toHaveBeenCalledWith((require('@/constants').LogType as any).SIMULATION);
  });
});
