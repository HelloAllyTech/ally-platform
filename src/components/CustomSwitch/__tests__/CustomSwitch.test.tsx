import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';

import {CustomSwitch} from '../CustomSwitch';

describe('CustomSwitch', () => {
  it('renders without crashing', () => {
    const onToggle = jest.fn();
    const {toJSON} = render(<CustomSwitch onToggle={onToggle} />);
    expect(toJSON()).not.toBeNull();
  });

  it('calls onToggle with true when pressed in off state (uncontrolled)', () => {
    const onToggle = jest.fn();
    const {UNSAFE_getByType} = render(<CustomSwitch onToggle={onToggle} />);
    const {TouchableOpacity} = require('react-native');
    const toggle = UNSAFE_getByType(TouchableOpacity);
    fireEvent.press(toggle);
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it('calls onToggle with false when pressed in on state (controlled)', () => {
    const onToggle = jest.fn();
    const {UNSAFE_getByType} = render(
      <CustomSwitch value onToggle={onToggle} />,
    );
    const {TouchableOpacity} = require('react-native');
    const toggle = UNSAFE_getByType(TouchableOpacity);
    fireEvent.press(toggle);
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it('calls onToggle with true when pressed in off state (controlled)', () => {
    const onToggle = jest.fn();
    const {UNSAFE_getByType} = render(
      <CustomSwitch value={false} onToggle={onToggle} />,
    );
    const {TouchableOpacity} = require('react-native');
    const toggle = UNSAFE_getByType(TouchableOpacity);
    fireEvent.press(toggle);
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it('renders with custom color', () => {
    const onToggle = jest.fn();
    const {toJSON} = render(
      <CustomSwitch value onToggle={onToggle} color="#ff0000" />,
    );
    expect(toJSON()).not.toBeNull();
  });
});
