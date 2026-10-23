import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';

import {CustomTabs} from '@/components/CustomTabs';

const tabs = [
  {key: 'a', title: 'Tab A'},
  {key: 'b', title: 'Tab B'},
  {key: 'c', title: 'Tab C'},
];

describe('CustomTabs', () => {
  it('renders all tabs and switches active tab (uncontrolled)', () => {
    const onTabChange = jest.fn();
    const {getAllByRole} = render(
      <CustomTabs tabs={tabs} initialTab={0} onTabChange={onTabChange} />,
    );

    const tabButtons = getAllByRole('tab');
    fireEvent.press(tabButtons[1]);
    expect(onTabChange).toHaveBeenCalledWith(1);

    fireEvent.press(tabButtons[2]);
    expect(onTabChange).toHaveBeenCalledWith(2);
  });

  it('respects controlled activeTab prop', () => {
    const onTabChange = jest.fn();
    const {getAllByRole, rerender} = render(
      <CustomTabs tabs={tabs} activeTab={0} onTabChange={onTabChange} />,
    );

    const tabButtons = getAllByRole('tab');
    fireEvent.press(tabButtons[1]);
    // onTabChange called but activeTab controlled externally
    expect(onTabChange).toHaveBeenCalledWith(1);

    rerender(<CustomTabs tabs={tabs} activeTab={2} onTabChange={onTabChange} />);

    // Pressing other tabs continues to call onTabChange
    fireEvent.press(getAllByRole('tab')[0]);
    expect(onTabChange).toHaveBeenCalledWith(0);
  });
});
