import React from 'react';
import {fireEvent, render, act} from '@testing-library/react-native';

import {CustomDropdown} from '@/components/Dropdown';

describe('CustomDropdown', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

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
    
    // Advance timers to clear animation
    act(() => {
      jest.runAllTimers();
    });

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
