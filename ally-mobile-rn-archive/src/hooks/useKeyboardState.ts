import {useEffect, useState} from 'react';
import {Keyboard} from 'react-native';

interface KeyboardState {
  isVisible: boolean;
  height: number;
}

export const useKeyboardState = (
  onKeyboardChange?: (keyboardState: KeyboardState) => void,
) => {
  const [keyboardState, setKeyboardState] = useState<KeyboardState>({
    isVisible: false,
    height: 0,
  });

  useEffect(() => {
    const keyboardDidShowListener = Keyboard.addListener(
      'keyboardDidShow',
      event => {
        const newState = {
          isVisible: true,
          height: event.endCoordinates.height,
        };
        setKeyboardState(newState);
        onKeyboardChange?.(newState);
      },
    );

    const keyboardDidHideListener = Keyboard.addListener(
      'keyboardDidHide',
      () => {
        const newState = {
          isVisible: false,
          height: 0,
        };
        setKeyboardState(newState);
        onKeyboardChange?.(newState);
      },
    );

    return () => {
      keyboardDidShowListener?.remove();
      keyboardDidHideListener?.remove();
    };
  }, [onKeyboardChange]);

  return keyboardState;
};
