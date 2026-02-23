import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';

import {ActionsMenu} from '../ActionsMenu';

jest.mock('@/assets', () => ({
  ThreeDotsIcon: 'ThreeDotsIcon',
}));

const mockOptions = [
  {label: 'Edit', onPress: jest.fn()},
  {label: 'Delete', onPress: jest.fn()},
  {label: 'Share', onPress: jest.fn()},
];

describe('ActionsMenu', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockOptions.forEach(opt => (opt.onPress as jest.Mock).mockClear());
  });

  it('renders the trigger button', () => {
    const {toJSON} = render(<ActionsMenu options={mockOptions} />);
    expect(toJSON()).not.toBeNull();
  });

  it('does not show menu options initially', () => {
    const {queryByText} = render(<ActionsMenu options={mockOptions} />);
    expect(queryByText('Edit')).toBeNull();
    expect(queryByText('Delete')).toBeNull();
  });

  it('renders with custom icon', () => {
    const {Text} = require('react-native');
    const CustomIcon = <Text testID="custom-trigger">Menu</Text>;
    const {getByTestId} = render(
      <ActionsMenu options={mockOptions} icon={CustomIcon} />,
    );
    expect(getByTestId('custom-trigger')).toBeTruthy();
  });

  it('renders menu options with left icons', () => {
    const {Text} = require('react-native');
    const LeftIcon = <Text testID="left-icon">L</Text>;
    const optionsWithIcons = [
      {label: 'Edit', onPress: jest.fn(), leftIcon: LeftIcon},
    ];
    const {toJSON} = render(<ActionsMenu options={optionsWithIcons} />);
    expect(toJSON()).not.toBeNull();
  });

  it('renders menu options with right icons', () => {
    const {Text} = require('react-native');
    const RightIcon = <Text testID="right-icon">R</Text>;
    const optionsWithIcons = [
      {label: 'Share', onPress: jest.fn(), rightIcon: RightIcon},
    ];
    const {toJSON} = render(<ActionsMenu options={optionsWithIcons} />);
    expect(toJSON()).not.toBeNull();
  });

  it('renders with empty options array', () => {
    const {toJSON} = render(<ActionsMenu options={[]} />);
    expect(toJSON()).not.toBeNull();
  });

  it('renders with custom iconSize', () => {
    const {toJSON} = render(
      <ActionsMenu options={mockOptions} iconSize={32} />,
    );
    expect(toJSON()).not.toBeNull();
  });
});
