import React, {useMemo, useRef, useState} from 'react';
import {Text, TextStyle, View, ViewStyle} from 'react-native';
import {Gesture, GestureDetector} from 'react-native-gesture-handler';
import {runOnJS} from 'react-native-reanimated';
import {ScaledSheet} from 'react-native-size-matters';

import {colors, fontFamily, typography} from '@/theme';

import {SelectableTextInputProps} from '../SelectableTextInput/SelectableTextInput';

export interface MessageProps {
  timestamp: string;
  message: React.ReactElement<SelectableTextInputProps>;
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
  onPress = () => {},
}) => {
  const longPressRef = useRef<any>(null);

  const [menuOpen, setMenuOpen] = useState(false);

  const tapGesture = useMemo(() => {
    return Gesture.Tap()
      .enabled(!menuOpen) // ✅ disable tap while menu is visible
      .onEnd(() => {
        runOnJS(onPress)();
      })
      .requireExternalGestureToFail(longPressRef);
  }, [menuOpen, onPress, longPressRef]);

  // ✅ Inject visibility callback into the message element
  const messageWithCallback = useMemo(() => {
    if (!React.isValidElement(message)) return message;

    return React.cloneElement(message, {
      // this prop will be received by SelectableTextInput
      onMenuVisibilityChange: setMenuOpen,
    });
  }, [message]);

  return (
    <View style={[styles.container, containerStyle]}>
      <Text style={[styles.timestamp, timestampStyle]}>({timestamp})</Text>
      <GestureDetector gesture={tapGesture}>
        <View style={[styles.messageContainer, styles.message]}>
          {messageWithCallback}
        </View>
      </GestureDetector>
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    flexDirection: 'row',
    paddingHorizontal: '16@ms',
    paddingVertical: '6@mvs',
  },
  timestamp: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    color: 'rgba(0, 0, 0, 0.6)',
    marginRight: '8@ms',
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
