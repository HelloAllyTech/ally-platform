import React, {useEffect, useRef} from 'react';
import {Animated, Text, TouchableOpacity, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ms, ScaledSheet} from 'react-native-size-matters';

import {EditIcon, ExportIcon} from '@/assets/icons';
import {isIOS, SCREEN_WIDTH} from '@/constants/general';
import useTranslate from '@/hooks/useTranslate';
import {colors} from '@/theme/colors';
import {fontFamily} from '@/theme/fonts';

interface CustomMenuModalProps {
  visible: boolean;
  onClose: () => void;
  onExport: () => void;
  setModalType: (type: 'rename' | 'delete' | null) => void;
}

const CustomMenuModal: React.FC<CustomMenuModalProps> = ({
  visible,
  onClose,
  onExport,
  setModalType,
}) => {
  const insets = useSafeAreaInsets();
  const {t} = useTranslate();
  const fadeAnim = useRef(new Animated.Value(0)).current;

  const onRename = () => {
    setModalType('rename');
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

  const onPressDelete = () => {
    setModalType('delete');
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
            marginTop: insets.top + 60,
            width: Math.min(200, SCREEN_WIDTH * 0.7),
            opacity: fadeAnim,
            transform: [
              {
                translateY: fadeAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [-10, 0],
                }),
              },
            ],
          },
          !isIOS && styles.androidShadow,
        ]}>
        <TouchableOpacity style={styles.menuItem} onPress={onRename}>
          <Text style={styles.menuText}>{t('CallSummary.info.rename')}</Text>
          <EditIcon width={16} height={16} />
        </TouchableOpacity>
        <View style={styles.menuDivider} />
        <TouchableOpacity style={styles.menuItem} onPress={onExport}>
          <Text style={styles.menuText}>
            {t('CallSummary.customMenu.export')}
          </Text>
          <ExportIcon width={16} height={16} />
        </TouchableOpacity>
        {/* <View style={styles.menuDivider} /> */}
        {/* Hiding delete option for now */}
        {/* <TouchableOpacity style={styles.menuItem} onPress={onPressDelete}>
          <Text style={styles.menuText}>
            {t('CallSummary.customMenu.delete')}
          </Text>
          <DeleteIcon width={16} height={16} />
        </TouchableOpacity> */}
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
  menuContainer: {
    position: 'absolute',
    right: ms(20),
    backgroundColor: colors.white,
    borderRadius: ms(8),
    paddingVertical: ms(4),
    shadowColor: colors.darkGray,
    shadowOffset: {width: 0, height: ms(2)},
    shadowOpacity: 0.2,
    shadowRadius: ms(8),
    elevation: 5,
  },
  androidShadow: {
    elevation: 8,
    shadowColor: colors.black,
    shadowOffset: {width: 0, height: ms(4)},
    shadowOpacity: 0.3,
    shadowRadius: ms(4.65),
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: ms(8),
    paddingHorizontal: ms(20),
    minHeight: ms(44),
  },
  menuText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: ms(15),
    color: colors.black,
  },
  menuDivider: {
    height: ms(0.5),
    backgroundColor: colors.lightGray2,
    marginHorizontal: ms(10),
  },
});

export default CustomMenuModal;
