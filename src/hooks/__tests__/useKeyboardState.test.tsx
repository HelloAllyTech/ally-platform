import React from 'react';
import {Keyboard} from 'react-native';
import {act, render} from '@testing-library/react-native';
import {Text} from 'react-native';

import {useKeyboardState} from '../useKeyboardState';

const TestComponent = ({onChange}: {onChange?: any}) => {
  const state = useKeyboardState(onChange);
  return (
    <>
      <Text>{state.isVisible ? 'visible' : 'hidden'}</Text>
      <Text>{String(state.height)}</Text>
    </>
  );
};

describe('useKeyboardState', () => {
  it('updates visibility and height on keyboard show/hide', () => {
    const listeners: Record<string, Array<(e?: any) => void>> = {};
    jest.spyOn(Keyboard, 'addListener').mockImplementation(((event: any, cb: any) => {
      listeners[event] = listeners[event] || [];
      listeners[event].push(cb);
      return {remove: jest.fn()};
    }) as any);
    const onChange = jest.fn();
    const {getByText} = render(<TestComponent onChange={onChange} />);

    // simulate show
    act(() => {
      listeners['keyboardDidShow']?.forEach(fn => fn({endCoordinates: {height: 250}}));
    });
    expect(getByText('visible')).toBeTruthy();
    expect(getByText('250')).toBeTruthy();
    expect(onChange).toHaveBeenCalledWith({isVisible: true, height: 250});

    // simulate hide
    act(() => {
      listeners['keyboardDidHide']?.forEach(fn => fn());
    });
    expect(getByText('hidden')).toBeTruthy();
    expect(getByText('0')).toBeTruthy();
    expect(onChange).toHaveBeenCalledWith({isVisible: false, height: 0});
  });
});


