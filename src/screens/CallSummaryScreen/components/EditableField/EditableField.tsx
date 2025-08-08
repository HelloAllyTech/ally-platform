import React, {useEffect, useRef} from 'react';
import {TextInput, View} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import {ScaledSheet} from 'react-native-size-matters';

import {SummaryFieldKey} from '@/constants/summary';
import {colors, fontFamily} from '@/theme';

interface EditableFieldProps {
  fieldKey: SummaryFieldKey;
  label: string;
  value: string | null;
  onChangeText: (text: string) => void;
  placeholder?: string;
  canEdit: boolean;
  isEditing: boolean;
  isEnhancing: boolean;
}

const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

// TO DO: Replace with original text component or else delete this file
export const EditableField: React.FC<EditableFieldProps> = ({
  fieldKey,
  label,
  value,
  onChangeText,
  placeholder,
  canEdit,
  isEditing,
  isEnhancing,
}) => {
  const inputRef = useRef<TextInput>(null);
  const opacity = useSharedValue(1);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      // Defer focus to next tick to ensure TextInput is fully rendered and focusable
      setTimeout(() => {
        inputRef.current?.focus();
      });
    }
  }, [isEditing, canEdit, isEnhancing]);

  useEffect(() => {
    if (isEnhancing) {
      // Start pulsing animation when enhancing
      opacity.value = withRepeat(
        withSequence(
          withTiming(0.5, {duration: 800}),
          withTiming(1, {duration: 800}),
        ),
        -1, // Infinite repeat
        true, // Reverse
      );
    } else {
      // Stop animation and reset to full opacity
      opacity.value = withTiming(1, {duration: 300});
    }
  }, [isEnhancing, opacity]);

  const animatedStyle = useAnimatedStyle(() => {
    return {
      opacity: opacity.value,
    };
  });

  return (
    <View style={styles.container}>
      <AnimatedTextInput
        ref={inputRef}
        style={[
          canEdit && isEditing ? styles.editableText : styles.displayText,
          animatedStyle,
        ]}
        key={fieldKey}
        value={value || ''}
        onChangeText={onChangeText}
        placeholder={
          !isEditing ? placeholder || `Add ${label?.toLowerCase()}` : ''
        }
        placeholderTextColor={colors.lightGray3}
        multiline
        editable={canEdit && isEditing && !isEnhancing}
      />
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    marginBottom: '16@vs',
  },
  editableText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '14@ms',
    lineHeight: '20@mvs',
    color: colors.black,
    marginRight: '20@ms',
  },
  displayText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '14@ms',
    lineHeight: '20@mvs',
    color: colors.lightGray3,
  },
});
