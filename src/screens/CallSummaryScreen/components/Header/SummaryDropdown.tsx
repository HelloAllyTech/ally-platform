import React, {useEffect, useRef} from 'react';
import {Animated, Text, TouchableOpacity, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ScaledSheet} from 'react-native-size-matters';

import {CallIcon, TickIcon, TranscriptIcon} from '@/assets/icons';
import {isIOS, SCREEN_WIDTH} from '@/constants/general';
import {useTranslate} from '@/hooks';
import {colors, fontFamily} from '@/theme';

interface SummaryDropdownProps {
  visible: boolean;
  onClose: () => void;
  isFullyExpanded?: boolean;
  showSummary: boolean;
  setShowSummary: (show: boolean) => void;
}

export const SummaryDropdown: React.FC<SummaryDropdownProps> = ({
  visible,
  onClose,
  isFullyExpanded = true,
  showSummary,
  setShowSummary,
}) => {
  const insets = useSafeAreaInsets();
  const {t} = useTranslate();
  const fadeAnim = useRef(new Animated.Value(0)).current;

  const onSummary = () => {
    setShowSummary(true);
    onClose();
  };

  useEffect(() => {
    if (visible) {
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }
  }, [visible, fadeAnim]);

  const onTranscript = () => {
    setShowSummary(false);
    onClose();
  };

  if (!visible) return null;

  return (
    <View style={styles.container}>
      <Animated.View
        style={[
          styles.overlay,
          {
            opacity: fadeAnim,
          },
        ]}>
        <TouchableOpacity
          style={styles.overlayTouchable}
          activeOpacity={1}
          onPress={onClose}
        />
      </Animated.View>
      <Animated.View
        style={[
          styles.menuContainer,
          {
            marginTop: insets.top + (isFullyExpanded ? 55 : 70),
            width: Math.min(250, SCREEN_WIDTH * 0.7),
            opacity: fadeAnim,
            transform: [
              {
                translateY: fadeAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [-10, 0],
                }),
              },
              {translateX: -Math.min(SCREEN_WIDTH * 0.32, 125)},
            ],
          },
          !isIOS && styles.androidShadow,
        ]}>
        <TouchableOpacity
          style={styles.menuItem}
          onPress={onSummary}
          activeOpacity={0.8}>
          <View style={styles.textContainer}>
            <CallIcon width={24} height={24} />
            <Text style={styles.menuText}>
              {t('CallSummary.header.callSummary')}
            </Text>
          </View>
          {showSummary && <TickIcon width={24} height={24} />}
        </TouchableOpacity>
        <View style={styles.menuDivider} />
        <TouchableOpacity
          style={styles.menuItem}
          onPress={onTranscript}
          activeOpacity={0.8}>
          <View style={styles.textContainer}>
            <TranscriptIcon width={24} height={24} />
            <Text style={styles.menuText}>
              {t('CallSummary.header.callTranscript')}
            </Text>
          </View>
          {!showSummary && <TickIcon width={24} height={24} />}
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 9999,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.whiteTransparent10,
  },
  overlayTouchable: {
    flex: 1,
  },
  textContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '10@ms',
  },
  menuContainer: {
    position: 'absolute',
    left: '50%',
    backgroundColor: colors.white,
    borderRadius: '8@ms',
    paddingHorizontal: '14@ms',
    borderWidth: 0.5,
    borderColor: colors.lightGray4,
    shadowColor: colors.lightGray5,
    shadowOffset: {width: 0, height: 3},
    shadowOpacity: 0.7,
    shadowRadius: 6,
    elevation: 5,
  },
  androidShadow: {
    elevation: 5,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: '14@ms',
  },
  menuText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '14@ms',
    color: colors.black,
  },
  menuDivider: {
    borderBottomWidth: 0.5,
    borderColor: colors.lightGray4,
  },
});
