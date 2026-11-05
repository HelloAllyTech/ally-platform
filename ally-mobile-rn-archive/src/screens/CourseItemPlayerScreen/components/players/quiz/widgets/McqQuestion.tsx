import React from 'react';
import {Text, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {useTranslate} from '@/hooks';
import {colors, fontFamily, fontWeights, typography} from '@/theme';
import {SanitizedQuizQuestion} from '@/types';
import {QuizAnswerState} from '@/utils';

export interface McqQuestionProps {
  question: SanitizedQuizQuestion;
  state: QuizAnswerState;
  onChange: (state: QuizAnswerState) => void;
}

/**
 * Multiple-choice question — radio for mcq_single, checkbox for mcq_multi.
 * Mirrors ally-web's `McqQuestion`.
 */
export const McqQuestion: React.FC<McqQuestionProps> = ({
  question,
  state,
  onChange,
}) => {
  const {t} = useTranslate();
  const isMulti = question.type === 'mcq_multi';
  const selected = state.selectedOptionIds ?? [];

  const toggle = (optionId: string) => {
    if (isMulti) {
      const next = selected.includes(optionId)
        ? selected.filter(id => id !== optionId)
        : [...selected, optionId];
      onChange({selectedOptionIds: next});
    } else {
      onChange({selectedOptionIds: [optionId]});
    }
  };

  return (
    <View>
      <Text style={styles.hint}>
        {isMulti
          ? t('courses.quiz.question.selectMultiple')
          : t('courses.quiz.question.selectPrompt')}
      </Text>
      <View style={styles.list}>
        {(question.options ?? []).map(option => {
          const isSelected = selected.includes(option.id);
          return (
            <TouchableOpacity
              key={option.id}
              testID={`mcq-option-${option.id}`}
              activeOpacity={0.7}
              onPress={() => toggle(option.id)}
              style={[styles.option, isSelected && styles.optionSelected]}>
              <View
                style={[
                  styles.indicator,
                  isMulti ? styles.indicatorSquare : styles.indicatorRound,
                  isSelected && styles.indicatorSelected,
                ]}>
                {isSelected && (
                  <View
                    style={
                      isMulti
                        ? styles.indicatorDotSquare
                        : styles.indicatorDotRound
                    }
                  />
                )}
              </View>
              <Text style={styles.optionText}>{option.text}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
};

const styles = ScaledSheet.create({
  hint: {
    ...fontFamily.ROBOTO.REGULAR,
    ...typography.body.tiny,
    fontWeight: fontWeights.medium,
    color: colors.ds.typography.lowEmphasis,
    textTransform: 'uppercase',
    marginBottom: '10@ms',
  },
  list: {
    gap: '8@ms',
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '10@ms',
    borderWidth: 1,
    borderColor: colors.ds.stroke.primary,
    borderRadius: '12@ms',
    padding: '12@ms',
    backgroundColor: colors.ds.neutral.white,
  },
  optionSelected: {
    borderColor: colors.ds.theme.primary,
    backgroundColor: colors.ds.lightBlue[50],
  },
  indicator: {
    width: '20@ms',
    height: '20@ms',
    borderWidth: 2,
    borderColor: colors.ds.grey[300],
    alignItems: 'center',
    justifyContent: 'center',
  },
  indicatorRound: {
    borderRadius: '10@ms',
  },
  indicatorSquare: {
    borderRadius: '4@ms',
  },
  indicatorSelected: {
    borderColor: colors.ds.theme.primary,
    backgroundColor: colors.ds.theme.primary,
  },
  indicatorDotRound: {
    width: '8@ms',
    height: '8@ms',
    borderRadius: '4@ms',
    backgroundColor: colors.ds.neutral.white,
  },
  indicatorDotSquare: {
    width: '8@ms',
    height: '8@ms',
    borderRadius: '2@ms',
    backgroundColor: colors.ds.neutral.white,
  },
  optionText: {
    flex: 1,
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    fontWeight: fontWeights.regular,
    color: colors.ds.typography.highEmphasis,
  },
});
