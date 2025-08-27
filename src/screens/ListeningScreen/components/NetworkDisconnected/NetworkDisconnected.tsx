import React from 'react';
import {Text, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {NetworkDisconnectedIcon} from '@/assets';
import {PrimaryButton} from '@/components';
import {useNetworkConnectivity, useTranslate} from '@/hooks';
import {colors, fontFamily} from '@/theme';
import {DisconnectedType} from '@/types';

interface NetworkDisconnectedProps {
  onRetry: () => void;
  onGoBack: () => void;
  disconnectedType: DisconnectedType | null;
}

export const NetworkDisconnected: React.FC<NetworkDisconnectedProps> = ({
  onRetry,
  onGoBack,
  disconnectedType,
}) => {
  const {t} = useTranslate();
  const {isOffline} = useNetworkConnectivity();

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <NetworkDisconnectedIcon />
        <Text style={styles.title}>
          {disconnectedType === DisconnectedType.SOCKET
            ? t('Common.offline.socketTitle')
            : t('Common.offline.networkTitle')}
        </Text>
        <Text style={styles.description}>
          {disconnectedType === DisconnectedType.SOCKET
            ? t('Common.offline.socketDescription')
            : t('Common.offline.networkDescription')}
        </Text>
        {!isOffline && (
          <PrimaryButton
            label={t('Common.offline.tryAgain')}
            onPress={onRetry}
            customContainerStyle={[styles.buttonContainer, styles.bgWhite]}
            customTextStyle={styles.secondaryText}
          />
        )}
        <PrimaryButton
          label={t('Common.offline.goBack')}
          onPress={onGoBack}
          customContainerStyle={[styles.buttonContainer, styles.bgDarkGray7]}
          customTextStyle={styles.whiteText}
        />
      </View>
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: '20@ms',
  },
  card: {
    alignItems: 'center',
    width: '100%',
  },
  title: {
    ...fontFamily.REPLAY_PRO.HEADLINE,
    color: colors.white,
    fontSize: '20@ms',
    textAlign: 'center',
    marginTop: '20@mvs',
    marginBottom: '10@mvs',
  },
  description: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    color: colors.white,
    fontSize: '14@ms',
    lineHeight: '18@ms',
    textAlign: 'center',
    marginBottom: '20@mvs',
  },
  buttonContainer: {
    width: '60%',
    paddingVertical: '10@mvs',
    marginBottom: '12@mvs',
  },
  bgWhite: {
    backgroundColor: colors.white,
  },
  secondaryText: {
    color: colors.black,
  },
  bgDarkGray7: {
    backgroundColor: colors.darkGray7,
  },
  whiteText: {
    color: colors.white,
  },
});
