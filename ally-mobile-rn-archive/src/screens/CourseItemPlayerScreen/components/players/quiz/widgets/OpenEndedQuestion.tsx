import React from 'react';
import {Text, TextInput, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {useTranslate} from '@/hooks';
import {colors, fontFamily, typography} from '@/theme';
import {SanitizedQuizQuestion} from '@/types';
import {QuizAnswerState, wordCount} from '@/utils';

export interface OpenEndedQuestionProps {
  question: SanitizedQuizQuestion;
  state: QuizAnswerState;
  onChange: (state: QuizAnswerState) => void;
}

/**
 * Open-ended question — a multiline text input with a live word count
 * against the minimum, plus an "AI graded" hint. Mirrors ally-web's
 * `OpenEndedQuestion`.
 */
export const OpenEndedQuestion: React.FC<OpenEndedQuestionProps> = ({
  question,
  state,
  onChange,
}) => {
  const {t, tVariable} = useTranslate();
  const text = state.text ?? '';
  const minWords = question.minWords ?? 0;
  const count = wordCount(text);

  return (
    <View>
      <TextInput
        testID="open-ended-input"
        style={styles.input}
        multiline
        numberOfLines={5}
        value={text}
        onChangeText={value => onChange({text: value})}
        placeholder={t('courses.journal.placeholder')}
      />
      <View style={styles.footer}>
        <Text style={styles.aiGradedHint}>
          {t('courses.quiz.question.aiGraded')}
        </Text>
        {minWords > 0 && (
          <Text
            style={[
              styles.wordCount,
              count >= minWords && styles.wordCountMet,
            ]}>
            {tVariable('courses.quiz.question.wordCount', {
              count,
              min: minWords,
            })}
          </Text>
        )}
      </View>
    </View>
  );
};

const styles = ScaledSheet.create({
  input: {
    borderWidth: 1,
    borderColor: colors.ds.stroke.primary,
    borderRadius: '10@ms',
    padding: '10@ms',
    minHeight: '96@ms',
    textAlignVertical: 'top',
    backgroundColor: colors.ds.grey[50],
    ...typography.body.medium,
    color: colors.ds.typography.highEmphasis,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: '8@ms',
  },
  aiGradedHint: {
    ...fontFamily.ROBOTO.REGULAR,
    ...typography.body.tiny,
    color: colors.ds.typography.lowEmphasis,
  },
  wordCount: {
    ...fontFamily.ROBOTO.REGULAR,
    ...typography.body.tiny,
    color: colors.ds.typography.lowEmphasis,
  },
  wordCountMet: {
    color: colors.ds.green[700],
  },
});
