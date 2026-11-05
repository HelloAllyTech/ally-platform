import React from 'react';
import {Text, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {useTranslate} from '@/hooks';
import {colors, fontFamily, fontWeights, typography} from '@/theme';
import {TrackRoleplaySessionFeedback} from '@/types';

const PREVIEW_LENGTH = 220;

/**
 * Plain-text preview of a judge's markdown feedback: strips the common
 * markdown markers rather than rendering them, and cuts at a word boundary —
 * a mid-token cut (e.g. an unterminated `**`) would render broken formatting
 * if this were passed to a real markdown renderer, so this is deliberately
 * plain text with a link to the full, properly-rendered feedback instead.
 */
const previewText = (markdown: string): string => {
  const plain = markdown
    .replace(/^#+\s*/gm, '')
    .replace(/^-\s*/gm, '')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (plain.length <= PREVIEW_LENGTH) return plain;
  const cut = plain.slice(0, PREVIEW_LENGTH);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > 0 ? lastSpace : PREVIEW_LENGTH)}…`;
};

interface LatestFeedbackPreviewProps {
  session: TrackRoleplaySessionFeedback;
  onPress: (session: TrackRoleplaySessionFeedback) => void;
}

/** The most recent evaluated session's feedback, previewed inline with a link out to the full screen. */
export const LatestFeedbackPreview: React.FC<LatestFeedbackPreviewProps> = ({
  session,
  onPress,
}) => {
  const {t} = useTranslate();

  if (!session.evaluationMarkdown) return null;

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>
        {t('courses.progressDashboard.latestFeedbackHeading')}
      </Text>
      <Text style={styles.preview}>
        {previewText(session.evaluationMarkdown)}
      </Text>
      <TouchableOpacity
        onPress={() => onPress(session)}
        accessibilityRole="button"
        testID="latest-feedback-read-more">
        <Text style={styles.link}>
          {t('courses.progressDashboard.readFullFeedback')}
        </Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    borderWidth: 1,
    borderColor: colors.ds.stroke.primary,
    borderRadius: '12@ms',
    padding: '12@ms',
  },
  heading: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.body.small,
    fontWeight: fontWeights.medium,
    color: colors.ds.typography.highEmphasis,
    marginBottom: '4@mvs',
  },
  preview: {
    ...fontFamily.ROBOTO.REGULAR,
    ...typography.body.small,
    color: colors.ds.typography.mediumEmphasis,
    marginBottom: '8@mvs',
  },
  link: {
    ...fontFamily.ROBOTO.REGULAR,
    ...typography.body.small,
    fontWeight: fontWeights.medium,
    color: colors.ds.theme.primary,
  },
});
