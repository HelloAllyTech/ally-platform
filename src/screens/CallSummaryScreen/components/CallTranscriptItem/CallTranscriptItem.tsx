import React from 'react';
import {Text, TextStyle, View, ViewStyle} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {colors, fontFamily} from '@/theme';

export type CallTranscriptItemProps = {
  time: string;
  message: string;
  speakerLabel?: string;
  containerStyle?: ViewStyle;
  timeStyle?: TextStyle;
  messageTextStyle?: TextStyle;
  messageStyle?: TextStyle;
};

export const CallTranscriptItem: React.FC<CallTranscriptItemProps> = ({
  time,
  message,
  speakerLabel,
  containerStyle,
  timeStyle,
  messageTextStyle,
  messageStyle,
}) => {
  return (
    <View style={[styles.messageContainer, containerStyle]}>
      <View style={styles.timeContainer}>
        <Text style={[styles.timeText, timeStyle]}>{time}</Text>
      </View>
      <View style={styles.messageContent}>
        <Text style={[styles.messageText, messageTextStyle]}>
          {speakerLabel ? `${speakerLabel}: ` : ''}
          <Text style={[styles.message, messageStyle]}>{message}</Text>
        </Text>
      </View>
    </View>
  );
};

const styles = ScaledSheet.create({
  messageContainer: {
    marginVertical: '7@mvs',
    flexDirection: 'row',
  },
  timeContainer: {
    width: '60@ms',
  },
  timeText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    color: colors.mediumGray2,
    fontSize: '14@ms',
    lineHeight: '20@mvs',
  },
  messageText: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    fontSize: '14@ms',
    lineHeight: '20@mvs',
    color: colors.black,
  },
  message: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    color: colors.charcoal2,
  },
  messageContent: {
    flex: 1,
  },
});
