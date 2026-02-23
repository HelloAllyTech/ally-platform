import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Text, TextInput, View} from 'react-native';
import {KeyboardAwareScrollView} from 'react-native-keyboard-aware-scroll-view';

import {useErrorToast} from '@/components';
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

const DEBOUNCE_DELAY = 1500;

export const Reflection: React.FC<ReflectionProps> = ({scenarioSessionId}) => {
  const {t} = useTranslate();
  const {showErrorToast} = useErrorToast();
  const [reflectionPrompts, setReflectionPrompts] =
    useState<ReflectionPrompt[]>();

  const debounceTimers = useRef<Record<string, NodeJS.Timeout>>({});

  const {data: reflectionPromptsData} = useGetReflectionPromptsQuery({
    scenarioSessionId,
  });

  const [updateReflectionPrompt] = useUpdateReflectionPromptMutation();

  useEffect(() => {
    if (reflectionPromptsData?.reflectionPrompts) {
      setReflectionPrompts(reflectionPromptsData.reflectionPrompts);
    }
  }, [reflectionPromptsData?.reflectionPrompts]);

  useEffect(() => {
    const timers = debounceTimers.current;
    return () => {
      Object.values(timers).forEach(clearTimeout);
    };
  }, []);

  const savePromptResponse = useCallback(
    async (promptId: string, response: string) => {
      try {
        await updateReflectionPrompt({
          scenarioSessionId,
          body: {promptId, response},
        }).unwrap();
      } catch (error) {
        showErrorToast(error, 'Errors.reflectionPromptSaveFailed');
      }
    },
    [scenarioSessionId, updateReflectionPrompt, showErrorToast],
  );

  const handleResponseChange = useCallback(
    (promptId: string, value: string) => {
      setReflectionPrompts(prev =>
        prev?.map(prompt =>
          prompt.id === promptId ? {...prompt, response: value} : prompt,
        ),
      );

      if (debounceTimers.current[promptId]) {
        clearTimeout(debounceTimers.current[promptId]);
      }

      debounceTimers.current[promptId] = setTimeout(() => {
        savePromptResponse(promptId, value);
        delete debounceTimers.current[promptId];
      }, DEBOUNCE_DELAY);
    },
    [savePromptResponse],
  );

  return (
    <SummaryCard title={t('SimulationFeedback.reflection.sectionTitle')}>
      <KeyboardAwareScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        enableOnAndroid
        extraScrollHeight={0}
        showsVerticalScrollIndicator={false}>
        {reflectionPrompts && reflectionPrompts.length > 0 ? (
          reflectionPrompts.map((prompt, index) => (
            <View key={prompt.id} style={styles.promptCard}>
              <View style={styles.badgeRow}>
                <View style={styles.numberBadge}>
                  <Text style={styles.numberBadgeText}>{index + 1}</Text>
                </View>
              </View>
              <Text style={styles.promptText}>{prompt.prompt}</Text>
              <TextInput
                style={styles.textInput}
                placeholder={t('SimulationFeedback.reflection.placeholder')}
                placeholderTextColor={colors.ds.typography.lowEmphasis}
                value={prompt.response || ''}
                onChangeText={value => handleResponseChange(prompt.id, value)}
                multiline
                textAlignVertical="top"
              />
            </View>
          ))
        ) : (
          <Text style={styles.emptyText}>
            {t('SimulationFeedback.reflection.noPromptsAvailable')}
          </Text>
        )}
      </KeyboardAwareScrollView>
    </SummaryCard>
  );
};
