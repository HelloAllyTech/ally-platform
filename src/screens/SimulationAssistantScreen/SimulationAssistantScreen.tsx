import React, {useEffect, useState} from 'react';
import {LiveKitRoom} from '@livekit/react-native';
import {useTranslation} from 'react-i18next';
import {SafeAreaView, Text, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {InfoIcon} from '@/assets/icons';
import {useAppNavigation, useLiveKitConnection} from '@/hooks';
import {colors, fontFamily} from '@/theme';

import {
  AudioWave,
  ConnectionLoader,
  ControlButtons,
  SimulationTimer,
} from './components';

export const SimulationAssistantScreen: React.FC = () => {
  const [startTime, setStartTime] = useState<number | null>(null);

  const {t} = useTranslation();
  const navigation = useAppNavigation();
  // Hardcoded LiveKit configuration for now
  const wsUrl = 'wss://ally-learn-poc-dev-lbzgnlp9.livekit.cloud/';
  const token = 'placeholder_token'; // TODO: Replace with actual token from ally-learn-fe

  const {
    room,
    status,
    isMicEnabled,
    error,
    connect,
    disconnect,
    toggleMic,
    shouldRenderRoom,
  } = useLiveKitConnection({
    wsUrl,
    token,
    onConnected: () => {
      setStartTime(Date.now());
    },
    onDisconnected: () => {
      setStartTime(null);
    },
    onError: errorMessage => {
      console.error('LiveKit connection error:', errorMessage);
    },
  });

  // Auto-connect when component mounts
  useEffect(() => {
    if (token) {
      connect();
    }
  }, [connect, token]);

  const handleMicPress = () => {
    toggleMic();
  };

  const handleStopPress = async () => {
    await disconnect();
    navigation.pop();
  };

  const isConnected = status === 'connected';

  return (
    <SafeAreaView style={styles.container}>
      {startTime && (
        <SimulationTimer startTime={startTime} isConnected={isConnected} />
      )}
      <AudioWave />
      <ControlButtons
        onMicPress={handleMicPress}
        onStopPress={handleStopPress}
        isMuted={!isMicEnabled}
      />
      <View style={styles.securityContainer}>
        <InfoIcon width={12} height={12} color={colors.lightGray3} />
        <Text style={styles.securityText}>
          {t('SimulationScreen.encryptionInfo')}
        </Text>
      </View>

      {/* LiveKit Room */}
      {shouldRenderRoom && (
        <LiveKitRoom room={room} serverUrl={wsUrl} token={token}>
          {/* LiveKit room content can be added here if needed */}
        </LiveKitRoom>
      )}

      {/* Connection Loader */}
      <ConnectionLoader status={status} error={error} />
    </SafeAreaView>
  );
};

const styles = ScaledSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.white,
    justifyContent: 'space-between',
    paddingHorizontal: '20@ms',
    paddingVertical: '40@mvs',
  },

  // Security Message Styles
  securityContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6@ms',
    marginBottom: '20@mvs',
  },
  securityText: {
    ...fontFamily.ROBOTO.REGULAR,
    fontSize: '12@ms',
    color: colors.lightGray3,
  },
});
