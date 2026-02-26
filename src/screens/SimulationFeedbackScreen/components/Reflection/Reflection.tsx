import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Keyboard, Pressable, Text, TextInput, View} from 'react-native';
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
    async (reflectionPromptId: string, promptId: string, response: string) => {
      try {
        await updateReflectionPrompt({
          scenarioSessionId,
          reflectionPromptId,
          body: {promptId, response},
        }).unwrap();
      } catch (error) {
        showErrorToast(error, 'Errors.reflectionPromptSaveFailed');
      }
    },
    [scenarioSessionId, updateReflectionPrompt, showErrorToast],
  );

  const handleResponseChange = useCallback(
    (reflectionPromptId: string, promptId: string, value: string) => {
      setReflectionPrompts(prev =>
        prev?.map(prompt =>
          prompt.id === reflectionPromptId
            ? {...prompt, response: value}
            : prompt,
        ),
      );

      if (debounceTimers.current[reflectionPromptId]) {
        clearTimeout(debounceTimers.current[reflectionPromptId]);
      }

      debounceTimers.current[reflectionPromptId] = setTimeout(() => {
        savePromptResponse(reflectionPromptId, promptId, value);
        delete debounceTimers.current[reflectionPromptId];
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
        keyboardDismissMode="on-drag"
        enableOnAndroid
        extraScrollHeight={0}
        showsVerticalScrollIndicator={false}>
        {reflectionPrompts && reflectionPrompts.length > 0 ? (
          reflectionPrompts.map((prompt, index) => (
            <Pressable
              key={prompt.id}
              style={styles.promptCard}
              onPress={Keyboard.dismiss}>
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
                onChangeText={value =>
                  handleResponseChange(prompt.id, prompt.promptId, value)
                }
                multiline
                textAlignVertical="top"
              />
            </Pressable>
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
