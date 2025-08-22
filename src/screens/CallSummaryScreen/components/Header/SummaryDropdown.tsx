import React, {useEffect, useMemo, useRef} from 'react';
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
  showSummary: boolean;
  setShowSummary: (show: boolean) => void;
}

interface MenuItemProps {
  icon: React.ReactNode;
  text: string;
  isSelected: boolean;
  onPress: () => void;
}

const MenuItem: React.FC<MenuItemProps> = ({
  icon,
  text,
  isSelected,
  onPress,
}) => (
  <TouchableOpacity
    style={styles.menuItem}
    onPress={onPress}
    activeOpacity={0.8}>
    <View style={styles.textContainer}>
      {icon}
      <Text style={styles.menuText}>{text}</Text>
    </View>
    {isSelected && <TickIcon width={24} height={24} />}
  </TouchableOpacity>
);

export const SummaryDropdown: React.FC<SummaryDropdownProps> = ({
  visible,
  onClose,
  showSummary,
  setShowSummary,
}) => {
  const insets = useSafeAreaInsets();
  const {t} = useTranslate();
  const fadeAnim = useRef(new Animated.Value(0)).current;

  const handleSummaryPress = () => {
    setShowSummary(true);
    onClose();
  };

  const handleTranscriptPress = () => {
    setShowSummary(false);
    onClose();
  };

  useEffect(() => {
    const animation = Animated.timing(fadeAnim, {
      toValue: visible ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    });
    animation.start();

    return () => animation.stop();
  }, [visible, fadeAnim]);

  const menuContainerStyle = useMemo(() => {
    const menuWidth = Math.min(250, SCREEN_WIDTH * 0.7);
    const translateX = -Math.min(SCREEN_WIDTH * 0.32, 125);
    const marginTop = insets.top + 70;

    return [
      styles.menuContainer,
      {
        marginTop,
        width: menuWidth,
        opacity: fadeAnim,
        transform: [
          {
            translateY: fadeAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [-10, 0],
            }),
          },
          {translateX},
        ],
      },
      !isIOS && styles.androidShadow,
    ];
  }, [fadeAnim, insets.top]);

  const overlayStyle = useMemo(
    () => [styles.overlay, {opacity: fadeAnim}],
    [fadeAnim],
  );

  if (!visible) return null;

  return (
    <View style={styles.container}>
      <Animated.View style={overlayStyle}>
        <TouchableOpacity
          style={styles.overlayTouchable}
          activeOpacity={1}
          onPress={onClose}
        />
      </Animated.View>

      <Animated.View style={menuContainerStyle}>
        <MenuItem
          icon={<CallIcon width={24} height={24} />}
          text={t('CallSummary.header.callSummary')}
          isSelected={showSummary}
          onPress={handleSummaryPress}
        />

        <View style={styles.menuDivider} />

        <MenuItem
          icon={<TranscriptIcon width={24} height={24} />}
          text={t('CallSummary.header.callTranscript')}
          isSelected={!showSummary}
          onPress={handleTranscriptPress}
        />
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
