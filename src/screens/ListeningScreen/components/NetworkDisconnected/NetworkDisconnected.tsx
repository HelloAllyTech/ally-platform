import React from 'react';
import {Text, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {NetworkDisconnectedIcon} from '@/assets';
import {Button} from '@/components';
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

  const getTitle = () => {
    switch (disconnectedType) {
      case DisconnectedType.SOCKET:
        return t('common.somethingWentWrong');
      case DisconnectedType.NETWORK:
        return t('common.offline.networkTitle');
      case DisconnectedType.MICROPHONE_FAILURE:
        return t('common.offline.microphoneFailureTitle');
      default:
        return t('common.somethingWentWrong');
    }
  };

  const getDescription = () => {
    switch (disconnectedType) {
      case DisconnectedType.SOCKET:
        return t('common.offline.socketDescription');
      case DisconnectedType.NETWORK:
        return t('common.offline.networkDescription');
      case DisconnectedType.MICROPHONE_FAILURE:
        return t('common.offline.microphoneFailureDescription');
      default:
        return t('common.offline.socketDescription');
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <NetworkDisconnectedIcon />
        <Text style={styles.title}>{getTitle()}</Text>
        <Text style={styles.description}>{getDescription()}</Text>
        {!isOffline && (
          <Button
            label={t('common.offline.tryAgain')}
            onPress={onRetry}
            customContainerStyle={[styles.buttonContainer, styles.bgWhite]}
            customTextStyle={styles.secondaryText}
          />
        )}
        <Button
          label={t('common.offline.goBack')}
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
