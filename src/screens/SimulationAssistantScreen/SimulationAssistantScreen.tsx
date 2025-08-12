import React, {useEffect, useState} from 'react';
import {LiveKitRoom, RoomContext} from '@livekit/react-native';
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
  TokenInputModal,
} from './components';

export const SimulationAssistantScreen: React.FC = () => {
  const [startTime, setStartTime] = useState<number | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [token, setToken] = useState<string>('');
  const [showTokenModal, setShowTokenModal] = useState<boolean>(true);
  const maxRetries = 3;

  const {t} = useTranslation();
  const navigation = useAppNavigation();
  // Hardcoded LiveKit configuration for now
  const wsUrl = 'wss://ally-learn-poc-dev-lbzgnlp9.livekit.cloud/';

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
      setRetryCount(0); // Reset retry count on successful connection
      setShowTokenModal(false); // Hide modal on successful connection
    },
    onDisconnected: () => {
      setStartTime(null);
    },
    onError: errorMessage => {
      // TODO: Handle error
    },
  });

  // Auto-connect when component mounts and token is available
  useEffect(() => {
    if (token && token.trim()) {
      connect();
    }
  }, [connect, token]);

  const handleTokenSubmit = (submittedToken: string) => {
    setToken(submittedToken);
    setShowTokenModal(false);
    setRetryCount(0); // Reset retry count when new token is provided
  };

  const handleTokenModalCancel = () => {
    // If user cancels token input, navigate back
    navigation.pop();
  };

  const handleRetry = async () => {
    if (retryCount < maxRetries) {
      setRetryCount(prev => prev + 1);
      try {
        await connect();
      } catch (error) {
        // TODO: Handle error
      }
    } else {
      // Max retries reached, show different message or navigate back
    }
  };

  const handleGoBack = () => {
    navigation.pop();
  };

  const handleMicPress = () => {
    toggleMic();
  };

  const handleStopPress = async () => {
    await disconnect();
    navigation.pop();
  };

  const isConnected = status === 'connected';

  // Show token modal again if we have an invalid token error
  const shouldShowTokenModal = showTokenModal || (!!error && !isConnected);

  return (
    <SafeAreaView style={styles.container}>
      <RoomContext.Provider value={room}>
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
        {shouldRenderRoom && token && (
          <LiveKitRoom room={room} serverUrl={wsUrl} token={token}>
            {/* LiveKit room content can be added here if needed */}
          </LiveKitRoom>
        )}

        {/* Connection Loader */}
        <ConnectionLoader
          status={status}
          error={error}
          onRetry={retryCount < maxRetries ? handleRetry : undefined}
          onGoBack={handleGoBack}
          maxRetriesReached={retryCount >= maxRetries}
        />

        {/* Token Input Modal */}
        <TokenInputModal
          visible={shouldShowTokenModal}
          onTokenSubmit={handleTokenSubmit}
          onCancel={handleTokenModalCancel}
        />
      </RoomContext.Provider>
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
