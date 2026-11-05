import {memo, useEffect, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {
  Animated,
  PanResponder,
  SafeAreaView,
  Text,
  TouchableOpacity,
} from 'react-native';
import NetworkLogger, {
  startNetworkLogging,
  stopNetworkLogging,
} from 'react-native-network-logger';
import {ScaledSheet} from 'react-native-size-matters';

import {CloseCircle} from '@/assets/icons';
import {SCREEN_WIDTH, WINDOW_HEIGHT} from '@/constants';
import {colors} from '@/theme';

const NetworkLogsComponent = ({onPress}: {onPress?: () => void}) => {
  const {t} = useTranslation();
  const [isNetworkModalVisible, setIsNetworkVIsible] = useState(false);
  const pan = useRef(new Animated.ValueXY()).current;

  useEffect(() => {
    if (__DEV__) {
      // Start logging only in development to avoid memory growth in prod
      startNetworkLogging();
    }
    return () => {
      if (__DEV__) {
        stopNetworkLogging?.();
      }
    };
  }, []);

  const themeStyle = {
    background: {
      backgroundColor: colors.white,
    },
    primaryColorBackground: {
      backgroundColor: `${colors.blue}99`,
    },
    primary: {
      color: colors.brightRed,
    },
    border: {
      borderColor: colors.lightGray10,
    },
  };

  const theme = {
    colors: {
      background: colors.white,
      link: colors.blue,
      card: colors.white,
      text: colors.black,
    },
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderMove: Animated.event([null, {dx: pan.x, dy: pan.y}], {
        useNativeDriver: false,
      }),
      onPanResponderGrant: () => {
        pan.extractOffset();
      },
      onPanResponderRelease: () => {
        pan.flattenOffset();
      },
    }),
  ).current;

  return (
    <>
      {isNetworkModalVisible && (
        <SafeAreaView style={styles.customModalOverlay}>
          <SafeAreaView
            style={[styles.contentContainer, themeStyle.background]}>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={() => setIsNetworkVIsible(false)}>
              <CloseCircle width={24} height={24} />
            </TouchableOpacity>
            <NetworkLogger theme={theme} maxRows={100} compact />
          </SafeAreaView>
        </SafeAreaView>
      )}
      <Animated.View
        {...panResponder.panHandlers}
        style={[
          {transform: [{translateX: pan.x}, {translateY: pan.y}]},
          styles.container,
          themeStyle.primaryColorBackground,
          themeStyle.border,
        ]}>
        <TouchableOpacity
          onPress={() => {
            onPress && onPress();
            setIsNetworkVIsible(true);
          }}>
          <Text style={styles.content}>{t('calls.header.subtitle')}</Text>
        </TouchableOpacity>
      </Animated.View>
    </>
  );
};

const styles = ScaledSheet.create({
  container: {
    width: '50@s',
    height: '50@s',
    position: 'absolute',
    right: '20@s',
    bottom: '20@vs',
    borderRadius: '25@s',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    backgroundColor: colors.white,
  },
  content: {
    fontSize: '10@s',
    fontWeight: '700',
    textAlign: 'center',
    color: '#FFF',
  },
  contentContainer: {
    flex: 1,
    padding: '12@s',
    width: SCREEN_WIDTH,
  },
  closeButton: {
    width: '100%',
    height: '40@s',
    justifyContent: 'center',
    alignItems: 'flex-end',
    paddingHorizontal: '18@s',
  },
  close: {
    fontSize: '17@s',
    fontWeight: '600',
  },
  customModalOverlay: {
    width: SCREEN_WIDTH,
    height: WINDOW_HEIGHT,
    position: 'absolute',
    zIndex: 9999,
    backgroundColor: colors.white,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export const NetworkLogs = memo(NetworkLogsComponent);
