import React from 'react';
import {Text, TextStyle, View, ViewStyle} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {colors, fontFamily, typography} from '@/theme';

export interface MessageProps {
  timestamp: string;
  message: React.ReactNode;
  containerStyle?: ViewStyle;
  timestampStyle?: TextStyle;
  messageStyle?: TextStyle;
  onPress?: () => void;
}

export const Message: React.FC<MessageProps> = ({
  timestamp,
  message,
  containerStyle,
  timestampStyle,
}) => {
  return (
    <View style={[styles.container, containerStyle]}>
      <Text style={[styles.timestamp, timestampStyle]} numberOfLines={1}>
        {timestamp}
      </Text>
      <View style={[styles.messageContainer, styles.message]}>{message}</View>
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    flexDirection: 'row',
    paddingVertical: '6@mvs',
    gap: '16@ms',
  },
  timestamp: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    color: 'rgba(0, 0, 0, 0.6)',
    flexShrink: 0,
  },
  message: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    color: 'rgba(0, 0, 0, 0.87)',
    flex: 1,
  },
  messageContainer: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: '16@ms',
  },
  userName: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    color: colors.ds.theme.primary,
  },
});
