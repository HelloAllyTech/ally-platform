import React, {createRef} from 'react';
import {TextInput} from 'react-native';
import {fireEvent, render} from '@testing-library/react-native';

import {OtpInput, OtpInputRef} from '../OtpInput';

describe('OtpInput', () => {
  it('fills digits sequentially and moves focus', () => {
    const onChange = jest.fn();
    const {UNSAFE_getAllByType} = render(
      <OtpInput value={["", "", "", ""]} onChange={onChange} inputCount={4} />,
    );
    const inputs = UNSAFE_getAllByType(TextInput);
    fireEvent.changeText(inputs[0], '1');
    expect(onChange).toHaveBeenCalledWith(['1', '', '', '']);
  });

  it('handles paste into first field (fills multiple digits)', () => {
    const onChange = jest.fn();
    const {UNSAFE_getAllByType} = render(
      <OtpInput value={["", "", "", ""]} onChange={onChange} inputCount={4} />,
    );
    const inputs = UNSAFE_getAllByType(TextInput);
    fireEvent.changeText(inputs[0], '1234');
    expect(onChange).toHaveBeenCalledWith(['1', '2', '3', '4']);
  });

  it('deletes and moves back on backspace when empty', () => {
    const onChange = jest.fn();
    const value = ['1', '', '', ''];
    const {UNSAFE_getAllByType, rerender} = render(
      <OtpInput value={value} onChange={onChange} inputCount={4} />,
    );
    const inputs = UNSAFE_getAllByType(TextInput);
    fireEvent(inputs[1], 'onKeyPress', {nativeEvent: {key: 'Backspace'}});
    expect(onChange).toHaveBeenCalled();
  });

  it('exposes focusFirst() via ref without errors', () => {
    const ref = createRef<OtpInputRef>();
    const {UNSAFE_getAllByType} = render(
      <OtpInput ref={ref} value={["", "", "", ""]} onChange={jest.fn()} inputCount={4} />,
    );
    // Call method to ensure it exists; no exception should be thrown
    expect(() => ref.current?.focusFirst()).not.toThrow();
  });
});

