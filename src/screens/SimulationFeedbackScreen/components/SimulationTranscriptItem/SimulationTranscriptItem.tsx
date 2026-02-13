import React from 'react';
import {Text, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {colors, fontFamily} from '@/theme';

export type SimulationTranscriptItemProps = {
  time: string;
  message: string;
  speakerLabel?: string;
  isActive?: boolean;
  isLearner?: boolean;
};

export const SimulationTranscriptItem: React.FC<
  SimulationTranscriptItemProps
> = ({time, message, speakerLabel, isLearner = false}) => {
  const backgroundColor = isLearner
    ? colors.ds.blueAlpha[25]
    : colors.ds.deepPurpleAlpha[25];
  const borderColor = isLearner
    ? colors.ds.theme.primary
    : colors.ds.deepPurple[500];
  const speakerColor = isLearner
    ? colors.ds.theme.primary
    : colors.ds.deepPurple[800];

  return (
    <View
      style={[
        styles.messageContainer,
        {
          backgroundColor,
          borderColor,
        },
      ]}>
      <View style={[styles.aiClientLayout, isLearner && styles.learnerLayout]}>
        <Text style={styles.messageText}>
          {speakerLabel && (
            <Text style={styles.timeAndSpeaker}>
              <Text style={styles.timeInline}>{time} </Text>
              <Text style={[styles.speakerLabel, {color: speakerColor}]}>
                {speakerLabel}
              </Text>
              {'\n'}
            </Text>
          )}
          <Text style={styles.message}>{message}</Text>
        </Text>
      </View>
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
  learnerLayout: {
    flexDirection: 'row',
  },
  learnerContent: {
    flex: 1,
    marginLeft: '16@ms',
  },
  aiClientLayout: {
    flex: 1,
  },
  speakerRow: {
    flexDirection: 'row',
    marginBottom: '4@vs',
  },
  timeText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '10@ms',
    color: colors.ds.typography.mediumEmphasis,
    letterSpacing: '0.25@ms',
    lineHeight: '24@vs',
    minWidth: '30@ms',
  },
  timeInline: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '13@ms',
    color: colors.ds.typography.mediumEmphasis,
    letterSpacing: '0.1@ms',
  },
  timeAndSpeaker: {
    lineHeight: '24@vs',
  },
  speakerLabel: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    fontSize: '13@ms',
    letterSpacing: '0.25@ms',
    lineHeight: '24@vs',
  },
  messageText: {
    fontSize: '13@ms',
    lineHeight: '24@vs',
  },
  message: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '13@ms',
    color: colors.ds.typography.highEmphasis,
    letterSpacing: '0.25@ms',
    lineHeight: '24@vs',
  },
});
