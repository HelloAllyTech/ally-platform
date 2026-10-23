import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';

import {DropdownMenu} from '@/components/DropdownMenu';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

describe('DropdownMenu', () => {
  const items = [
    {icon: <></>, text: 'One', onPress: jest.fn()},
    {icon: <></>, text: 'Two', onPress: jest.fn()},
  ];

  it('does not render when not visible', () => {
    const {queryByText} = render(
      <DropdownMenu visible={false} onClose={jest.fn()} items={items} />,
    );
    expect(queryByText('One')).toBeNull();
  });

  it('renders items when visible and calls onPress + onClose', () => {
    const onClose = jest.fn();
    const onItemPress = jest.fn();
    const {getByText} = render(
      <DropdownMenu
        visible
        onClose={onClose}
        items={[
          {icon: <></>, text: 'One', onPress: onItemPress},
          {icon: <></>, text: 'Two', onPress: jest.fn()},
        ]}
      />,
    );

    fireEvent.press(getByText('One'));
    expect(onItemPress).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
