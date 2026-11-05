import React, {useEffect, useRef} from 'react';
import {
  KeyboardTypeOptions,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import {ScaledSheet} from 'react-native-size-matters';

import {SummaryFieldKey} from '@/constants/summary';
import {colors, fontFamily, typography} from '@/theme';

interface EditableFieldProps {
  fieldKey: SummaryFieldKey;
  label: string;
  value: string | null;
  onChangeText: (text: string) => void;
  placeholder?: string;
  canEdit: boolean;
  isEditing: boolean;
  isEnhancing: boolean;
  keyboardType?: KeyboardTypeOptions;
}

const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);
const AnimatedText = Animated.createAnimatedComponent(Text);
export const EditableField: React.FC<EditableFieldProps> = ({
  fieldKey,
  label,
  value,
  onChangeText,
  placeholder,
  canEdit,
  isEditing,
  isEnhancing,
  keyboardType = 'default',
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

  const animatedStyle = useAnimatedStyle(() => ({opacity: opacity.value}));

  return (
    <View style={styles.container}>
      {canEdit && isEditing ? (
        <AnimatedTextInput
          ref={inputRef}
          style={[styles.editableText, animatedStyle]}
          key={fieldKey}
          value={value || ''}
          onChangeText={onChangeText}
          placeholderTextColor={colors.lightGray3}
          keyboardType={keyboardType}
          multiline
          scrollEnabled
        />
      ) : (
        <Animated.View style={animatedStyle}>
          <ScrollView
            style={styles.displayWrapper}
            nestedScrollEnabled
            showsVerticalScrollIndicator
            keyboardShouldPersistTaps="handled">
            <AnimatedText style={styles.displayText}>
              {value && value.length
                ? value
                : placeholder || `Add ${label?.toLowerCase()}`}
            </AnimatedText>
          </ScrollView>
        </Animated.View>
      )}
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    marginBottom: '16@vs',
  },
  editableText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    color: colors.ds.typography.highEmphasis,
    marginRight: '20@ms',
    maxHeight: '200@ms',
  },
  displayWrapper: {
    maxHeight: '200@ms',
  },
  displayText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '14@ms',
    lineHeight: '20@mvs',
    color: colors.lightGray3,
  },
});
