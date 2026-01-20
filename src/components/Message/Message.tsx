import {useRef} from 'react';
import {Text, TextStyle, View, ViewStyle} from 'react-native';
import {Gesture, GestureDetector} from 'react-native-gesture-handler';
import {runOnJS} from 'react-native-reanimated';
import {ScaledSheet} from 'react-native-size-matters';

import {fontFamily, typography} from '@/theme';

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
  onPress = () => {},
}) => {
  const longPressRef = useRef<any>(null);

  const tapGesture = Gesture.Tap()
    .onEnd(() => {
      runOnJS(onPress)();
    })
    .requireExternalGestureToFail(longPressRef);

  return (
    <View style={[styles.container, containerStyle]}>
      <Text style={[styles.timestamp, timestampStyle]}>{timestamp}</Text>
      <GestureDetector gesture={tapGesture}>
        <View style={[styles.messageContainer, styles.message]}>{message}</View>
      </GestureDetector>
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    flexDirection: 'row',
    gap: '16@ms',
    paddingHorizontal: '16@ms',
    paddingVertical: '12@mvs',
  },
  timestamp: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    color: 'rgba(0, 0, 0, 0.6)',
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
    color: 'rgba(0, 0, 0, 0.87)',
  },
});
