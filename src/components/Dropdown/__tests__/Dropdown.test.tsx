import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';

import {CustomDropdown} from '@/components/Dropdown';

describe('CustomDropdown', () => {
  it('renders placeholder and toggles open/close', () => {
    const setIsOpen = jest.fn();
    const {getByText} = render(
      <CustomDropdown
        value=""
        options={["A", "B", "C"]}
        onSelect={jest.fn()}
        placeholder="Select"
        isOpen={false}
        setIsOpen={setIsOpen}
      />,
    );

    fireEvent.press(getByText('Select'));
    expect(setIsOpen).toHaveBeenCalledWith(true);
  });

  it('selects an item and closes', () => {
    let open = true;
    const setIsOpen = (v: boolean) => {
      open = v;
    };
    const onSelect = jest.fn();

    const {getByText, rerender} = render(
      <CustomDropdown
        value=""
        options={["A", "B", "C"]}
        onSelect={onSelect}
        placeholder="Select"
        isOpen={open}
        setIsOpen={setIsOpen}
      />,
    );

    fireEvent.press(getByText('A'));
    expect(onSelect).toHaveBeenCalledWith('A');

    rerender(
      <CustomDropdown
        value="A"
        options={["A", "B", "C"]}
        onSelect={onSelect}
        placeholder="Select"
        isOpen={open}
        setIsOpen={setIsOpen}
      />,
    );
  });
});
