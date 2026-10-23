import React, {useState} from 'react';
import {Text, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {useTranslate} from '@/hooks';
import {colors, fontFamily, typography} from '@/theme';
import {SanitizedQuizQuestion} from '@/types';
import {
  applyMatchSelection,
  breakMatch,
  leftIdForRight,
  QuizAnswerState,
  rightIdForLeft,
} from '@/utils';

export interface MatchingQuestionProps {
  question: SanitizedQuizQuestion;
  state: QuizAnswerState;
  onChange: (state: QuizAnswerState) => void;
}

/** A stable colour per pair index so a matched left/right share a chip colour. */
const PAIR_COLORS = [
  {
    bg: colors.ds.lightBlue[100],
    border: colors.ds.lightBlue[300],
    text: colors.ds.theme.primary,
  },
  {
    bg: colors.ds.green[50],
    border: colors.ds.green[300],
    text: colors.ds.green[800],
  },
  {
    bg: colors.ds.amber[50],
    border: colors.ds.amber[300],
    text: colors.ds.amber[800],
  },
  {
    bg: colors.ds.deepPurple[50],
    border: colors.ds.deepPurple[300],
    text: colors.ds.deepPurple[800],
  },
];

/**
 * Matching question — tap a left item, then a right item to pair them (the
 * pairing reducer lives in `quizHelpers`). Tap a paired item to break it.
 * The right column arrives pre-shuffled from the server. Mirrors ally-web's
 * `MatchingQuestion`.
 */
export const MatchingQuestion: React.FC<MatchingQuestionProps> = ({
  question,
  state,
  onChange,
}) => {
  const {t} = useTranslate();
  const pairs = state.pairs ?? [];
  const [pendingLeft, setPendingLeft] = useState<string | null>(null);

  const pairIndexForLeft = (leftId: string) =>
    pairs.findIndex(p => p.leftId === leftId);

  const handleLeftPress = (leftId: string) => {
    const existingRight = rightIdForLeft(pairs, leftId);
    if (existingRight) {
      onChange({pairs: breakMatch(pairs, 'left', leftId)});
      setPendingLeft(null);
      return;
    }
    setPendingLeft(prev => (prev === leftId ? null : leftId));
  };

  const handleRightPress = (rightId: string) => {
    const existingLeft = leftIdForRight(pairs, rightId);
    if (existingLeft && !pendingLeft) {
      onChange({pairs: breakMatch(pairs, 'right', rightId)});
      return;
    }
    if (pendingLeft) {
      onChange({pairs: applyMatchSelection(pairs, pendingLeft, rightId)});
      setPendingLeft(null);
    }
  };

  const colorForLeft = (leftId: string) => {
    const idx = pairIndexForLeft(leftId);
    return idx >= 0 ? PAIR_COLORS[idx % PAIR_COLORS.length] : null;
  };
  const colorForRight = (rightId: string) => {
    const left = leftIdForRight(pairs, rightId);
    return left ? colorForLeft(left) : null;
  };

  return (
    <View>
      <Text style={styles.hint}>{t('courses.quiz.question.matchPrompt')}</Text>
      <View style={styles.grid}>
        <View style={styles.column}>
          {(question.left ?? []).map(option => {
            const color = colorForLeft(option.id);
            const isPending = pendingLeft === option.id;
            return (
              <TouchableOpacity
                key={option.id}
                testID={`matching-left-${option.id}`}
                activeOpacity={0.7}
                onPress={() => handleLeftPress(option.id)}
                style={[
                  styles.cell,
                  color
                    ? {backgroundColor: color.bg, borderColor: color.border}
                    : isPending && styles.cellPending,
                ]}>
                <Text
                  style={[
                    styles.cellText,
                    color && {color: color.text},
                    isPending && !color && styles.cellTextPending,
                  ]}>
                  {option.text}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <View style={styles.column}>
          {(question.right ?? []).map(option => {
            const color = colorForRight(option.id);
            return (
              <TouchableOpacity
                key={option.id}
                testID={`matching-right-${option.id}`}
                activeOpacity={0.7}
                onPress={() => handleRightPress(option.id)}
                style={[
                  styles.cell,
                  color && {
                    backgroundColor: color.bg,
                    borderColor: color.border,
                  },
                ]}>
                <Text style={[styles.cellText, color && {color: color.text}]}>
                  {option.text}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    </View>
  );
};

const styles = ScaledSheet.create({
  hint: {
    ...fontFamily.ROBOTO.REGULAR,
    ...typography.body.tiny,
    color: colors.ds.typography.lowEmphasis,
    textTransform: 'uppercase',
    marginBottom: '10@ms',
  },
  grid: {
    flexDirection: 'row',
    gap: '12@ms',
  },
  column: {
    flex: 1,
    gap: '8@ms',
  },
  cell: {
    borderWidth: 1,
    borderColor: colors.ds.stroke.primary,
    borderRadius: '10@ms',
    padding: '10@ms',
    backgroundColor: colors.ds.neutral.white,
  },
  cellPending: {
    borderColor: colors.ds.theme.primary,
    backgroundColor: colors.ds.lightBlue[50],
  },
  cellText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.small,
    color: colors.ds.typography.highEmphasis,
  },
  cellTextPending: {
    color: colors.ds.theme.primary,
  },
});
