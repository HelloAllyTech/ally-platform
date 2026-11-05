import React from 'react';
import {Text, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {useTranslate} from '@/hooks';
import {colors, fontFamily, fontWeights, typography} from '@/theme';
import {SanitizedQuizQuestion} from '@/types';
import {QuizAnswerState} from '@/utils';

export interface LikertScaleQuestionProps {
  question: SanitizedQuizQuestion;
  state: QuizAnswerState;
  onChange: (state: QuizAnswerState) => void;
}

/**
 * Likert-scale question — one statement per row, with the scale's points
 * (lowest to highest, as authored) rendered as a row of selectable pills.
 * Each statement is its own `radiogroup` so a screen reader announces the
 * statement as the group label rather than lumping every pill on the
 * question together. Never graded — there is no "correct" selection.
 * Mirrors ally-web's `LikertScaleQuestion`.
 */
export const LikertScaleQuestion: React.FC<LikertScaleQuestionProps> = ({
  question,
  state,
  onChange,
}) => {
  const {t} = useTranslate();
  const ratings = state.ratings ?? {};
  const statements = question.statements ?? [];
  const scale = question.scale ?? [];

  const setRating = (statementId: string, scaleOptionId: string) =>
    onChange({ratings: {...ratings, [statementId]: scaleOptionId}});

  return (
    <View>
      <Text style={styles.hint}>{t('courses.quiz.question.likertHint')}</Text>
      <View style={styles.list}>
        {statements.map(statement => {
          const selected = ratings[statement.id];
          return (
            <View
              key={statement.id}
              testID={`likert-statement-${statement.id}`}
              style={styles.statementBlock}>
              <Text style={styles.statementText}>{statement.text}</Text>
              <View
                accessibilityRole="radiogroup"
                accessibilityLabel={statement.text}
                style={styles.pillRow}>
                {scale.map(point => {
                  const isSelected = selected === point.id;
                  return (
                    <TouchableOpacity
                      key={point.id}
                      testID={`likert-option-${statement.id}-${point.id}`}
                      activeOpacity={0.7}
                      accessibilityRole="radio"
                      accessibilityState={{checked: isSelected}}
                      onPress={() => setRating(statement.id, point.id)}
                      style={[styles.pill, isSelected && styles.pillSelected]}>
                      <Text
                        style={[
                          styles.pillText,
                          isSelected && styles.pillTextSelected,
                        ]}>
                        {point.text}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
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
    gap: '16@ms',
  },
  statementBlock: {
    borderWidth: 1,
    borderColor: colors.ds.stroke.primary,
    borderRadius: '12@ms',
    padding: '12@ms',
    backgroundColor: colors.ds.neutral.white,
    gap: '10@ms',
  },
  statementText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    fontWeight: fontWeights.regular,
    color: colors.ds.typography.highEmphasis,
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: '8@ms',
  },
  pill: {
    borderWidth: 1,
    borderColor: colors.ds.stroke.primary,
    borderRadius: '20@ms',
    paddingHorizontal: '12@ms',
    paddingVertical: '8@ms',
    backgroundColor: colors.ds.neutral.white,
  },
  pillSelected: {
    borderColor: colors.ds.theme.primary,
    backgroundColor: colors.ds.lightBlue[50],
  },
  pillText: {
    ...fontFamily.ROBOTO.REGULAR,
    ...typography.body.tiny,
    color: colors.ds.typography.mediumEmphasis,
  },
  pillTextSelected: {
    fontWeight: fontWeights.medium,
    color: colors.ds.theme.primary,
  },
});
