import React, {useEffect, useState} from 'react';
import {Text, TextInput, View} from 'react-native';
import {KeyboardAwareScrollView} from 'react-native-keyboard-aware-scroll-view';

import {Button, useErrorToast} from '@/components';
import {useTranslate} from '@/hooks';
import {
  ReflectionPrompt,
  useGetReflectionPromptsQuery,
  useUpdateReflectionPromptMutation,
} from '@/services';
import {colors} from '@/theme';

import {SummaryCard} from '../SummaryCard';
import {styles} from './styles';

interface ReflectionProps {
  scenarioSessionId: string;
}

const DEFAULT_REFLECTION_PROMPTS: ReflectionPrompt[] = [
  {
    id: '1',
    prompt:
      '1. What do you think the client needed most in the moment you shifted to problem-solving?',
  },
  {
    id: '2',
    prompt: '2. Where did you feel unsure or rushed during the conversation?',
  },
];

export const Reflection: React.FC<ReflectionProps> = ({scenarioSessionId}) => {
  const {t} = useTranslate();
  const {showErrorToast} = useErrorToast();
  const [focusedPromptId, setFocusedPromptId] = useState<string | null>(null);
  const [reflectionPrompts, setReflectionPrompts] = useState<
    ReflectionPrompt[]
  >(DEFAULT_REFLECTION_PROMPTS);

  // TODO: Remove skip when API endpoint is deployed
  const {data: reflectionPromptsData} = useGetReflectionPromptsQuery(
    {
      scenarioSessionId,
    },
    {skip: true},
  );

  const [_updateReflectionPrompt] = useUpdateReflectionPromptMutation();

  useEffect(() => {
    if (reflectionPromptsData?.reflectionPrompts) {
      setReflectionPrompts(reflectionPromptsData.reflectionPrompts);
    }
  }, [reflectionPromptsData?.reflectionPrompts]);

  const handleResponseChange = (value: string) => {
    setReflectionPrompts(prev =>
      prev.map(prompt =>
        prompt.id === focusedPromptId ? {...prompt, response: value} : prompt,
      ),
    );
  };

  const handleClear = () => {
    const currentResponse = reflectionPrompts.find(
      prompt => prompt.id === focusedPromptId,
    )?.response;
    if (!currentResponse) {
      return;
    }
    setReflectionPrompts(prev =>
      prev.map(prompt =>
        prompt.id === focusedPromptId ? {...prompt, response: ''} : prompt,
      ),
    );
  };

  const handleSave = async () => {
    if (!focusedPromptId) {
      return;
    }
    const prompt = reflectionPrompts.find(
      promptItem => promptItem.id === focusedPromptId,
    );
    const _body = {
      promptId: focusedPromptId,
      response: prompt?.response || '',
    };
    try {
      // TODO: Uncomment when API endpoint is deployed
      // await _updateReflectionPrompt({scenarioSessionId, body: _body}).unwrap();
    } catch (error) {
      showErrorToast(error, 'Errors.reflectionPromptSaveFailed');
    }
  };

  return (
    <SummaryCard title={t('SimulationFeedback.reflection.sectionTitle')}>
      <KeyboardAwareScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        enableOnAndroid
        extraScrollHeight={0}
        showsVerticalScrollIndicator={false}>
        {reflectionPrompts.map(prompt => {
          return (
            <View key={prompt.id} style={styles.promptContainerWrapper}>
              <View
                style={[
                  styles.promptContainer,
                  focusedPromptId === prompt.id &&
                    styles.promptContainerFocused,
                ]}>
                <Text
                  style={[
                    styles.promptText,
                    focusedPromptId === prompt.id && styles.promptTextFocused,
                  ]}>
                  {prompt.prompt}
                </Text>
                <TextInput
                  style={styles.textInput}
                  placeholder={t('SimulationFeedback.reflection.placeholder')}
                  placeholderTextColor={colors.ds.typography.lowEmphasis}
                  value={prompt.response || ''}
                  onChangeText={handleResponseChange}
                  multiline
                  textAlignVertical="top"
                  onFocus={() => setFocusedPromptId(prompt.id)}
                  onBlur={() => setFocusedPromptId(null)}
                />
              </View>
              {focusedPromptId === prompt.id && (
                <View style={styles.buttonContainer}>
                  <Button
                    customContainerStyle={styles.button}
                    onPress={handleClear}
                    variant="secondary"
                    label={t('SimulationFeedback.reflection.clear')}
                  />
                  <Button
                    customContainerStyle={styles.button}
                    label={t('SimulationFeedback.reflection.save')}
                    onPress={handleSave}
                  />
                </View>
              )}
            </View>
          );
        })}
      </KeyboardAwareScrollView>
    </SummaryCard>
  );
};
