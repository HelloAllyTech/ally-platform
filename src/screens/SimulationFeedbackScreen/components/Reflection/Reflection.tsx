import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  Dimensions,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import {ms} from 'react-native-size-matters';

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
const SCROLL_PADDING = ms(40);

export const Reflection: React.FC<ReflectionProps> = ({scenarioSessionId}) => {
  const {t} = useTranslate();
  const {showErrorToast} = useErrorToast();
  const [reflectionPrompts, setReflectionPrompts] =
    useState<ReflectionPrompt[]>();

  const debounceTimers = useRef<Record<string, NodeJS.Timeout>>({});
  const scrollViewRef = useRef<ScrollView>(null);
  const inputRefs = useRef<Record<string, TextInput | null>>({});
  const focusedInputId = useRef<string | null>(null);
  const scrollOffsetRef = useRef(0);
  const isKeyboardVisible = useRef(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

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

  useEffect(() => {
    const showEvent =
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent =
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSub = Keyboard.addListener(showEvent, e => {
      const kbHeight = e.endCoordinates.height;
      setKeyboardHeight(kbHeight);

      if (!isKeyboardVisible.current) {
        isKeyboardVisible.current = true;
        setTimeout(() => {
          const promptId = focusedInputId.current;
          const inputRef = promptId ? inputRefs.current[promptId] : null;
          if (!inputRef || !scrollViewRef.current) {
            return;
          }
          inputRef.measureInWindow((_x, y, _w, h) => {
            if (y === undefined || y === null) {
              return;
            }
            const screenHeight = Dimensions.get('window').height;
            const keyboardTop = screenHeight - kbHeight;
            const inputBottom = y + h;
            if (inputBottom > keyboardTop - SCROLL_PADDING) {
              const delta = inputBottom - keyboardTop + SCROLL_PADDING;
              scrollViewRef.current?.scrollTo({
                y: scrollOffsetRef.current + delta,
                animated: true,
              });
            }
          });
        }, 350);
      }
    });

    const hideSub = Keyboard.addListener(hideEvent, () => {
      setKeyboardHeight(0);
      isKeyboardVisible.current = false;
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const handleScroll = useCallback(
    (e: {nativeEvent: {contentOffset: {y: number}}}) => {
      scrollOffsetRef.current = e.nativeEvent.contentOffset.y;
    },
    [],
  );

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
      <ScrollView
        ref={scrollViewRef}
        style={styles.scrollView}
        contentContainerStyle={[
          styles.scrollContent,
          keyboardHeight > 0 && {paddingBottom: keyboardHeight},
        ]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={16}>
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
                ref={ref => {
                  inputRefs.current[prompt.id] = ref;
                }}
                style={styles.textInput}
                placeholder={t('SimulationFeedback.reflection.placeholder')}
                placeholderTextColor={colors.ds.typography.lowEmphasis}
                value={prompt.response || ''}
                onChangeText={value =>
                  handleResponseChange(prompt.id, prompt.promptId, value)
                }
                onFocus={() => {
                  focusedInputId.current = prompt.id;
                }}
                onBlur={() => {
                  focusedInputId.current = null;
                }}
                multiline
                scrollEnabled
                textAlignVertical="top"
              />
            </Pressable>
          ))
        ) : (
          <Text style={styles.emptyText}>
            {t('SimulationFeedback.reflection.noPromptsAvailable')}
          </Text>
        )}
      </ScrollView>
    </SummaryCard>
  );
};
