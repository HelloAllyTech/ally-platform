import React, {useState} from 'react';
import {Text, TextInput, TouchableOpacity, View} from 'react-native';
import {KeyboardAwareScrollView} from 'react-native-keyboard-aware-scroll-view';

import {useTranslate} from '@/hooks';
import {colors} from '@/theme';

import {styles} from './styles';

const PROMPTS = [
  '1. What do you think the client needed most in the moment you shifted to problem-solving?',
  '2. Where did you feel unsure or rushed during the conversation?',
];

export const Reflection: React.FC = () => {
  const {t} = useTranslate();
  const [responses, setResponses] = useState<string[]>(
    Array(PROMPTS.length).fill(''),
  );
  const [focusedInput, setFocusedInput] = useState<number | null>(null);

  const handleResponseChange = (index: number, value: string) => {
    const newResponses = [...responses];
    newResponses[index] = value;
    setResponses(newResponses);
  };

  const handleClear = () => {
    if (focusedInput !== null) {
      handleResponseChange(focusedInput, '');
    }
  };

  const handleSave = () => {
    // TODO: Implement save functionality
  };

  return (
    <View style={styles.container}>
      <View style={styles.titleContainer}>
        <Text style={styles.title}>
          {t('SimulationFeedback.reflection.sectionTitle')}
        </Text>
      </View>
      <View style={styles.divider} />

      <KeyboardAwareScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        enableOnAndroid
        extraScrollHeight={0}
        showsVerticalScrollIndicator={false}>
        {PROMPTS.map((prompt, index) => (
          <View key={index} style={styles.promptContainerWrapper}>
            <View
              style={[
                styles.promptContainer,
                focusedInput === index && styles.promptContainerFocused,
              ]}>
              <Text
                style={[
                  styles.promptText,
                  focusedInput === index && styles.promptTextFocused,
                ]}>
                {prompt}
              </Text>
              <TextInput
                style={styles.textInput}
                placeholder={t('SimulationFeedback.reflection.placeholder')}
                placeholderTextColor={colors.ds.typography.lowEmphasis}
                value={responses[index]}
                onChangeText={value => handleResponseChange(index, value)}
                multiline
                textAlignVertical="top"
                onFocus={() => setFocusedInput(index)}
                onBlur={() => setFocusedInput(null)}
              />
            </View>
            {focusedInput === index && (
              <View style={styles.buttonContainer}>
                <TouchableOpacity
                  style={styles.clearButton}
                  onPress={handleClear}
                  activeOpacity={0.7}>
                  <Text style={styles.clearButtonText}>
                    {t('SimulationFeedback.reflection.clear')}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.saveButton}
                  onPress={handleSave}
                  activeOpacity={0.7}>
                  <Text style={styles.saveButtonText}>
                    {t('SimulationFeedback.reflection.save')}
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        ))}
      </KeyboardAwareScrollView>
    </View>
  );
};
