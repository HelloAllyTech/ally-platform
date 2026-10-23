import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';

import {TabView} from '../TabView';

jest.mock('@/hooks', () => ({
  useTranslate: () => ({t: (k: string) => k}),
}));

describe('TabView', () => {
  it('renders tabs and calls onTabChange on press', () => {
    const onTabChange = jest.fn();
    const {getByText} = render(
      <TabView
        tabs={[
          {key: 'one', label: 'One'},
          {key: 'two', label: 'Two'},
        ]}
        activeTab="one"
        onTabChange={onTabChange}
      />,
    );

    expect(getByText('One')).toBeTruthy();
    expect(getByText('Two')).toBeTruthy();

    fireEvent.press(getByText('Two'));
    expect(onTabChange).toHaveBeenCalledWith('two');
  });
});


