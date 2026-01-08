import React from 'react';
import {Text, TextStyle, TouchableOpacity, View, ViewStyle} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {colors, fontFamily} from '@/theme';

export type SimulationTranscriptItemProps = {
  time: string;
  message: string;
  speakerLabel?: string;
  containerStyle?: ViewStyle;
  timeStyle?: TextStyle;
  messageTextStyle?: TextStyle;
  messageStyle?: TextStyle;
  isActive?: boolean;
  onPress?: () => void;
};

export const SimulationTranscriptItem: React.FC<
  SimulationTranscriptItemProps
> = ({
  time,
  message,
  speakerLabel,
  containerStyle,
  timeStyle,
  messageTextStyle,
  messageStyle,
  isActive = false,
  onPress,
}) => {
  return (
    <TouchableOpacity
      style={[styles.messageContainer, containerStyle]}
      onPress={onPress}
      disabled={!onPress}
      activeOpacity={0.7}>
      <View style={styles.leftContainer}>
        <View
          style={[
            styles.activeIndicator,
            // eslint-disable-next-line react-native/no-inline-styles
            {
              backgroundColor: isActive
                ? colors.ds.theme.primary
                : 'transparent',
            },
          ]}
        />
        <View style={styles.timeContainer}>
          <Text style={[styles.timeText, timeStyle]}>{time}</Text>
        </View>
      </View>
      <View
        style={[styles.messageContent, isActive && styles.activeMessageText]}>
        <Text style={[styles.messageText, messageTextStyle]}>
          {!!speakerLabel && (
            <Text style={styles.speakerLabel}>{`${speakerLabel}: `}</Text>
          )}
          <Text style={[styles.message, messageStyle]}>{message}</Text>
        </Text>
      </View>
    </TouchableOpacity>
  );
};

const styles = ScaledSheet.create({
  messageContainer: {
    marginVertical: '7@mvs',
    flexDirection: 'row',
  },
  leftContainer: {
    flexDirection: 'row',
    width: '60@ms',
    marginRight: '8@ms',
  },
  activeIndicator: {
    width: '2@ms',
    marginRight: '8@ms',
    borderRadius: '1@ms',
  },
  timeContainer: {
    flex: 1,
  },
  timeText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    color: colors.mediumGray2,
    fontSize: '14@ms',
    lineHeight: '20@mvs',
  },
  messageContent: {
    flex: 1,
  },
  messageText: {
    fontSize: '14@ms',
    lineHeight: '20@mvs',
    color: colors.black,
  },
  speakerLabel: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    color: colors.black,
  },
  message: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    color: colors.charcoal2,
  },
  activeMessageText: {
    backgroundColor: colors.ds.blue[50],
  },
});
