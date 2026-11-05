import React from 'react';
import {Text, TextInput, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {colors, fontFamily, typography} from '@/theme';
import {SanitizedQuizQuestion} from '@/types';
import {
  FillBlankSegment,
  QuizAnswerState,
  splitFillBlankTemplate,
} from '@/utils';

const isBlankSegment = (
  segment: FillBlankSegment,
): segment is {kind: 'blank'; blankId: string} => segment.kind === 'blank';

export interface FillBlankQuestionProps {
  question: SanitizedQuizQuestion;
  state: QuizAnswerState;
  onChange: (state: QuizAnswerState) => void;
}

/**
 * Fill-in-the-blank question. RN has no robust equivalent to an `<input>`
 * sitting inline inside flowing text, so unlike ally-web's `FillBlankQuestion`
 * (which inserts inputs directly into the sentence), this renders the full
 * template as read-only text followed by a numbered list of labeled inputs
 * — one per blank — a deliberate, simpler layout rather than a fragile
 * absolute-positioning hack.
 */
export const FillBlankQuestion: React.FC<FillBlankQuestionProps> = ({
  question,
  state,
  onChange,
}) => {
  const segments = splitFillBlankTemplate(question.template ?? '');
  const blanks = state.blanks ?? {};
  const blankSegments = segments.filter(isBlankSegment);

  const setBlank = (blankId: string, value: string) =>
    onChange({blanks: {...blanks, [blankId]: value}});

  return (
    <View>
      <Text style={styles.template}>
        {segments.map((segment, i) =>
          segment.kind === 'text' ? (
            segment.value
          ) : (
            <Text key={i} style={styles.blankMarker}>
              {' '}
              ____{' '}
            </Text>
          ),
        )}
      </Text>

      <View style={styles.blankList}>
        {blankSegments.map((segment, index) => (
          <View key={segment.blankId} style={styles.blankRow}>
            <Text style={styles.blankLabel}>{index + 1}.</Text>
            <TextInput
              testID={`fill-blank-input-${segment.blankId}`}
              style={styles.blankInput}
              value={blanks[segment.blankId] ?? ''}
              onChangeText={value => setBlank(segment.blankId, value)}
              accessibilityLabel={`blank ${segment.blankId}`}
            />
          </View>
        ))}
      </View>
    </View>
  );
};

const styles = ScaledSheet.create({
  template: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.large,
    color: colors.ds.typography.highEmphasis,
    marginBottom: '16@ms',
  },
  blankMarker: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    color: colors.ds.theme.primary,
  },
  blankList: {
    gap: '8@ms',
  },
  blankRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '8@ms',
  },
  blankLabel: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.body.medium,
    color: colors.ds.typography.mediumEmphasis,
  },
  blankInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.ds.stroke.primary,
    borderRadius: '8@ms',
    paddingHorizontal: '10@ms',
    paddingVertical: '8@ms',
    backgroundColor: colors.ds.neutral.white,
    ...typography.body.medium,
    color: colors.ds.typography.highEmphasis,
  },
});
