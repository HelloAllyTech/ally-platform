import React, {useRef, forwardRef, useImperativeHandle, useState} from 'react';
import {View, TextInput} from 'react-native';

import {isNumeric} from '@/utils/validation';

import {styles} from './styles';

import type {OtpInputProps} from './types';

export interface OtpInputRef {
  focusFirst: () => void;
}

export const OtpInput = forwardRef<OtpInputRef, OtpInputProps>(
  ({value, onChange, inputCount = 4, hasError = false}, ref) => {
    const inputRefs = useRef<TextInput[]>([]);
    const [focusedIndex, setFocusedIndex] = useState<number | null>(null);

    useImperativeHandle(ref, () => ({
      focusFirst: () => {
        inputRefs.current[0]?.focus();
      },
    }));

    const clearAndFocusPrevious = (currentIndex: number) => {
      if (currentIndex > 0) {
        const newValue = [...value];
        newValue[currentIndex - 1] = '';
        onChange(newValue);
        inputRefs.current[currentIndex - 1]?.focus();
      }
    };

    const handleInputChange = (text: string, index: number) => {
      if (!isNumeric(text)) return;

      const newValue = [...value];
      newValue[index] = text;
      onChange(newValue);

      if (text && index < inputCount - 1) {
        inputRefs.current[index + 1]?.focus();
      }
    };

    const handleKeyPress = (
      {nativeEvent: {key}}: {nativeEvent: {key: string}},
      index: number,
    ) => {
      if (key === 'Backspace') {
        if (value[index]) {
          const newValue = [...value];
          newValue[index] = '';
          onChange(newValue);
        } else {
          clearAndFocusPrevious(index);
        }
      }
    };

    return (
      <View style={styles.inputContainer}>
        {[...Array(inputCount)].map((_, index) => (
          <View
            key={index}
            style={[styles.inputWrapper, hasError && styles.inputWrapperError]}>
            {!value[index] && focusedIndex !== index && (
              <View style={styles.inputDash} />
            )}
            <TextInput
              ref={_ref => {
                if (_ref) inputRefs.current[index] = _ref;
              }}
              style={[
                styles.input,
                value[index] ? styles.inputFilled : styles.inputEmpty,
              ]}
              maxLength={1}
              keyboardType="number-pad"
              value={value[index]}
              onChangeText={text => handleInputChange(text, index)}
              onKeyPress={e => handleKeyPress(e, index)}
              onFocus={() => setFocusedIndex(index)}
              onBlur={() => setFocusedIndex(null)}
            />
          </View>
        ))}
      </View>
    );
  },
);
