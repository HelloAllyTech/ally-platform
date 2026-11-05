import React from 'react';
import {Text, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {ArrowRight} from '@/assets';
import {useTranslate} from '@/hooks';
import {colors, fontFamily, fontWeights, typography} from '@/theme';
import {SanitizedQuizQuestion} from '@/types';
import {QuizAnswerState} from '@/utils';

export interface OrderingQuestionProps {
  question: SanitizedQuizQuestion;
  state: QuizAnswerState;
  onChange: (state: QuizAnswerState) => void;
}

/**
 * Ordering question — up/down buttons to reorder rows. Mirrors ally-web's
 * `OrderingQuestion`, minus the drag-and-drop interaction: dnd-kit has no
 * mobile equivalent already in this project, and adding a native
 * drag-reorder library is a deliberate v1 scope-cut rather than an
 * untested, unverifiable dependency added at the end of this port. The
 * arrow buttons are web's own accessible alternative to dragging, so this
 * is a real, complete way to answer the question — just without the drag
 * gesture as a second option.
 */
export const OrderingQuestion: React.FC<OrderingQuestionProps> = ({
  question,
  state,
  onChange,
}) => {
  const {t} = useTranslate();
  const orderedIds =
    state.orderedItemIds ?? (question.items ?? []).map(i => i.id);
  const byId = new Map((question.items ?? []).map(i => [i.id, i]));

  const move = (from: number, to: number) => {
    if (to < 0 || to >= orderedIds.length) return;
    const next = [...orderedIds];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange({orderedItemIds: next});
  };

  return (
    <View>
      <Text style={styles.hint}>{t('courses.quiz.question.orderPrompt')}</Text>
      <View style={styles.list}>
        {orderedIds.map((id, index) => {
          const option = byId.get(id);
          if (!option) return null;
          return (
            <View key={id} style={styles.row}>
              <Text style={styles.optionText}>{option.text}</Text>
              <View style={styles.moveButtons}>
                <TouchableOpacity
                  testID={`ordering-up-${id}`}
                  accessibilityLabel={t('courses.quiz.question.moveUp')}
                  disabled={index === 0}
                  onPress={() => move(index, index - 1)}
                  style={[
                    styles.moveButton,
                    index === 0 && styles.moveButtonDisabled,
                  ]}>
                  <ArrowRight
                    width={14}
                    height={14}
                    style={styles.rotateUp}
                    color={colors.ds.typography.mediumEmphasis}
                  />
                </TouchableOpacity>
                <TouchableOpacity
                  testID={`ordering-down-${id}`}
                  accessibilityLabel={t('courses.quiz.question.moveDown')}
                  disabled={index === orderedIds.length - 1}
                  onPress={() => move(index, index + 1)}
                  style={[
                    styles.moveButton,
                    index === orderedIds.length - 1 &&
                      styles.moveButtonDisabled,
                  ]}>
                  <ArrowRight
                    width={14}
                    height={14}
                    style={styles.rotateDown}
                    color={colors.ds.typography.mediumEmphasis}
                  />
                </TouchableOpacity>
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
    gap: '8@ms',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '10@ms',
    borderWidth: 1,
    borderColor: colors.ds.stroke.primary,
    borderRadius: '12@ms',
    padding: '12@ms',
    backgroundColor: colors.ds.neutral.white,
  },
  optionText: {
    flex: 1,
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    fontWeight: fontWeights.regular,
    color: colors.ds.typography.highEmphasis,
  },
  moveButtons: {
    flexDirection: 'row',
    gap: '4@ms',
  },
  moveButton: {
    width: '32@ms',
    height: '32@ms',
    borderRadius: '16@ms',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.ds.grey[50],
  },
  moveButtonDisabled: {
    opacity: 0.3,
  },
  rotateUp: {
    transform: [{rotate: '-90deg'}],
  },
  rotateDown: {
    transform: [{rotate: '90deg'}],
  },
});
