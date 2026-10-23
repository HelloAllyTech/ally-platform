import {forwardRef, useImperativeHandle, useRef, useState} from 'react';
import {TextInput, View} from 'react-native';

import {KeyCode} from '@/constants';
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
      // Handle pasted content
      if (index === 0 && text.length > 1) {
        // If text length is greater than 1, it's likely a paste operation
        const digits = text.slice(0, inputCount).split('');
        if (digits.every(digit => isNumeric(digit))) {
          // Fill all inputs with the pasted digits
          onChange(digits.concat(Array(inputCount - digits.length).fill('')));
          // Focus the last filled input
          inputRefs.current[digits.length - 1]?.focus();
          return;
        }
      }

      // Handle single digit input
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
      if (key === KeyCode.Backspace) {
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
              maxLength={index === 0 ? inputCount : 1}
              keyboardType="number-pad"
              value={value[index]}
              onChangeText={text => handleInputChange(text, index)}
              onKeyPress={e => handleKeyPress(e, index)}
              onFocus={() => setFocusedIndex(index)}
              onBlur={() => setFocusedIndex(null)}
              returnKeyType={value.every(v => v !== '') ? 'go' : 'default'}
            />
          </View>
        ))}
      </View>
    );
  },
);
