import React from 'react';
import {Text, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {useTranslate} from '@/hooks';
import {colors, fontFamily, fontWeights, typography} from '@/theme';
import {QuizAnswerState} from '@/utils';

export interface TrueFalseQuestionProps {
  state: QuizAnswerState;
  onChange: (state: QuizAnswerState) => void;
}

/**
 * True/false question — two large tappable option cards. Mirrors ally-web's
 * `TrueFalseQuestion`.
 */
export const TrueFalseQuestion: React.FC<TrueFalseQuestionProps> = ({
  state,
  onChange,
}) => {
  const {t} = useTranslate();

  const options = [
    {
      value: true,
      label: t('courses.quiz.question.true'),
      testID: 'true-false-true',
    },
    {
      value: false,
      label: t('courses.quiz.question.false'),
      testID: 'true-false-false',
    },
  ];

  return (
    <View style={styles.row}>
      {options.map(option => {
        const isSelected = state.booleanAnswer === option.value;
        return (
          <TouchableOpacity
            key={String(option.value)}
            testID={option.testID}
            activeOpacity={0.7}
            onPress={() => onChange({booleanAnswer: option.value})}
            style={[styles.card, isSelected && styles.cardSelected]}>
            <Text style={[styles.label, isSelected && styles.labelSelected]}>
              {option.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

const styles = ScaledSheet.create({
  row: {
    flexDirection: 'row',
    gap: '12@ms',
  },
  card: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.ds.stroke.primary,
    borderRadius: '14@ms',
    paddingVertical: '20@ms',
    alignItems: 'center',
    backgroundColor: colors.ds.neutral.white,
  },
  cardSelected: {
    borderColor: colors.ds.theme.primary,
    backgroundColor: colors.ds.lightBlue[50],
  },
  label: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.body.large,
    fontWeight: fontWeights.medium,
    color: colors.ds.typography.highEmphasis,
  },
  labelSelected: {
    color: colors.ds.theme.primary,
  },
});
