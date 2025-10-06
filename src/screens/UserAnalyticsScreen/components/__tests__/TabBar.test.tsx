import React from 'react';
import {render, fireEvent} from '@testing-library/react-native';

import {TabBar} from '../TabBar';
import {ANALYTICS_TABS} from '@/constants/analytics';

describe('TabBar', () => {
  it('renders all analytics tabs', () => {
    const onTabChange = jest.fn();
    const {getByText} = render(
      <TabBar selectedTab="D" onTabChange={onTabChange} />,
    );

    ANALYTICS_TABS.forEach(tab => {
      expect(getByText(tab)).toBeTruthy();
    });
  });

  it('invokes onTabChange when a tab is pressed', () => {
    const onTabChange = jest.fn();
    const {getByText} = render(
      <TabBar selectedTab="D" onTabChange={onTabChange} />,
    );

    fireEvent.press(getByText('W'));
    expect(onTabChange).toHaveBeenCalledWith('W');

    fireEvent.press(getByText('M'));
    expect(onTabChange).toHaveBeenCalledWith('M');
  });
});


