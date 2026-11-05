import React from 'react';
import {Text, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {colors, fontFamily} from '@/theme';

export type CallTranscriptItemProps = {
  time: string;
  message: string;
  speakerLabel?: string;
  counselor?: boolean;
  isDictation?: boolean;
};

export const CallTranscriptItem: React.FC<CallTranscriptItemProps> = ({
  time,
  message,
  speakerLabel,
  counselor = false,
  isDictation = false,
}) => {
  const backgroundColor = isDictation
    ? colors.white
    : counselor
      ? colors.ds.blueAlpha[25]
      : colors.ds.deepPurpleAlpha[25];
  const borderColor = isDictation
    ? colors.ds.grey[300]
    : counselor
      ? colors.ds.theme.primary
      : colors.ds.deepPurple[500];
  const speakerColor = counselor
    ? colors.ds.theme.primary
    : colors.ds.deepPurple[800];

  return (
    <View style={[styles.messageContainer, {backgroundColor, borderColor}]}>
      <View style={styles.speakerRow}>
        <Text style={styles.timeInline}>{time} </Text>
        {speakerLabel ? (
          <Text style={[styles.speakerLabel, {color: speakerColor}]}>
            {speakerLabel}
          </Text>
        ) : null}
      </View>
      <Text style={styles.message}>{message}</Text>
    </View>
  );
};

const styles = ScaledSheet.create({
  messageContainer: {
    borderWidth: '0.5@ms',
    borderRadius: '8@ms',
    padding: '12@ms',
    marginBottom: '16@vs',
  },
  speakerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '4@ms',
    marginBottom: '4@vs',
  },
  timeInline: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '13@ms',
    color: colors.ds.typography.mediumEmphasis,
    letterSpacing: '0.1@ms',
  },
  speakerLabel: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    fontSize: '13@ms',
    letterSpacing: '0.25@ms',
    lineHeight: '24@vs',
  },
  message: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '13@ms',
    color: colors.ds.typography.highEmphasis,
    letterSpacing: '0.25@ms',
    lineHeight: '20@vs',
  },
});
