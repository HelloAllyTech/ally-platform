import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';

import {ChipGroup} from '@/components/ChipGroup';

// Mock i18n so labels render as their keys
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string) => k,
  }),
}));

describe('ChipGroup', () => {
  const options = [
    {label: 'label_one' as any, value: 'one' as any},
    {label: 'label_two' as any, value: 'two' as any},
    {label: 'label_three' as any, value: 'three' as any},
  ];

  it('renders title and all chips', () => {
    const {getByText} = render(
      <ChipGroup
        title="Choose"
        options={options}
        selectedValues={[]}
        onSelectionChange={jest.fn()}
      />,
    );

    expect(getByText('Choose')).toBeTruthy();
    expect(getByText('label_one')).toBeTruthy();
    expect(getByText('label_two')).toBeTruthy();
    expect(getByText('label_three')).toBeTruthy();
  });

  it('calls onSelectionChange with toggled values', () => {
    const onSelectionChange = jest.fn();
    const {getByText} = render(
      <ChipGroup
        options={options}
        selectedValues={[]}
        onSelectionChange={onSelectionChange}
      />,
    );

    fireEvent.press(getByText('label_one'));
    expect(onSelectionChange).toHaveBeenCalledWith(['one']);
  });

  it('supports multi-select and deselect', () => {
    let selected: string[] = [];
    const handleChange = (next: string[]) => {
      selected = next;
    };

    const {getByText, rerender} = render(
      <ChipGroup
        options={options}
        selectedValues={selected}
        onSelectionChange={handleChange}
      />,
    );

    fireEvent.press(getByText('label_one'));
    rerender(
      <ChipGroup
        options={options}
        selectedValues={selected}
        onSelectionChange={handleChange}
      />,
    );

    fireEvent.press(getByText('label_two'));
    rerender(
      <ChipGroup
        options={options}
        selectedValues={selected}
        onSelectionChange={handleChange}
      />,
    );

    expect(selected.sort()).toEqual(['one', 'two']);

    // Deselect one
    fireEvent.press(getByText('label_one'));
    rerender(
      <ChipGroup
        options={options}
        selectedValues={selected}
        onSelectionChange={handleChange}
      />,
    );

    expect(selected).toEqual(['two']);
  });
});
