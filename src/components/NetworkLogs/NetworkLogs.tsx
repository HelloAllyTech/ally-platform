import {memo, useEffect, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {
  Animated,
  Modal,
  PanResponder,
  SafeAreaView,
  Text,
  TouchableOpacity,
} from 'react-native';
import NetworkLogger, {startNetworkLogging} from 'react-native-network-logger';
import {ScaledSheet} from 'react-native-size-matters';

import {CloseCircle} from '@/assets/icons';
import {colors} from '@/theme/colors';

const NetworkLogs = ({onPress}: {onPress?: () => void}) => {
  const {t} = useTranslation();
  const [isNetworkModalVisible, setIsNetworkVIsible] = useState(false);
  const pan = useRef(new Animated.ValueXY()).current;

  useEffect(() => {
    startNetworkLogging({forceEnable: true});
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
      card: colors.lightGray,
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
      <Modal
        style={styles.modal}
        visible={isNetworkModalVisible}
        animationType="slide"
        onRequestClose={() => setIsNetworkVIsible(false)}
        transparent={false}>
        <SafeAreaView style={[styles.contentContainer, themeStyle.background]}>
          <TouchableOpacity
            style={styles.closeButton}
            onPress={() => setIsNetworkVIsible(false)}>
            <CloseCircle width={24} height={24} />
          </TouchableOpacity>
          <NetworkLogger theme={theme} maxRows={100} compact />
        </SafeAreaView>
      </Modal>
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
          <Text style={styles.content}>{t('NetworkLogs.logs')}</Text>
        </TouchableOpacity>
      </Animated.View>
    </>
  );
};

const styles = ScaledSheet.create({
  modal: {
    margin: 0,
  },
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
});

export default memo(NetworkLogs);
