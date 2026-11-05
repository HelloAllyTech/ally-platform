import React from 'react';
import {Pressable, Text, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {colors, fontFamily} from '@/theme';

export type SimulationTranscriptItemProps = {
  time: string;
  message: string;
  speakerLabel?: string;
  isActive?: boolean;
  /** Briefly marks the moment a debrief chip jumped to. */
  isFocused?: boolean;
  isLearner?: boolean;
  onPress?: () => void;
};

export const SimulationTranscriptItem: React.FC<
  SimulationTranscriptItemProps
> = ({
  time,
  message,
  speakerLabel,
  isLearner = false,
  isActive = false,
  isFocused = false,
  onPress,
}) => {
  const backgroundColor = isLearner
    ? colors.ds.blueAlpha[25]
    : colors.ds.deepPurpleAlpha[25];
  const borderColor = isLearner
    ? colors.ds.theme.primary
    : colors.ds.deepPurple[500];
  const speakerColor = isLearner
    ? colors.ds.theme.primary
    : colors.ds.deepPurple[800];

  const shellStyle = [
    styles.messageContainer,
    {backgroundColor, borderColor},
    isActive && styles.messageContainerActive,
    // Sits after the playback-active style so a row that is both still reads
    // as the moment the learner just asked to see.
    isFocused && styles.messageContainerFocused,
  ];

  return (
    <Pressable
      disabled={!onPress}
      onPress={onPress}
      style={({pressed}) => [
        ...shellStyle,
        pressed && onPress && styles.messageContainerPressed,
      ]}>
      <View style={[styles.aiClientLayout, isLearner && styles.learnerLayout]}>
        <Text style={styles.timeAndSpeaker}>
          {speakerLabel && (
            <View style={styles.speakerRow}>
              <Text style={styles.timeInline}>{time} </Text>
              <Text style={[styles.speakerLabel, {color: speakerColor}]}>
                {speakerLabel}
              </Text>
            </View>
          )}
        </Text>
        <Text style={styles.message}>{message}</Text>
      </View>
    </Pressable>
  );
};

const styles = ScaledSheet.create({
  messageContainer: {
    borderWidth: '0.5@ms',
    borderRadius: '8@ms',
    padding: '12@ms',
    marginBottom: '16@vs',
  },
  messageContainerActive: {
    borderWidth: '1.5@ms',
  },
  messageContainerFocused: {
    borderWidth: '2@ms',
    borderColor: colors.ds.theme.primary,
  },
  messageContainerPressed: {
    opacity: 0.92,
  },
  learnerLayout: {
    flexDirection: 'column',
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
    alignItems: 'center',
    gap: '4@ms',
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
    lineHeight: '20@vs',
  },
});
