import React, {useCallback, useEffect, useState} from 'react';
import {RoomContext} from '@livekit/react-native';
import {Room, RoomEvent} from 'livekit-client';
import {useTranslation} from 'react-i18next';
import {SafeAreaView, Text, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {InfoIcon} from '@/assets/icons';
import {useAppNavigation} from '@/hooks';
import type {RootStackScreenProps} from '@/navigation/types';
import {useDeleteRoomMutation} from '@/services/simulationsApi';
import {colors, fontFamily} from '@/theme';

import {AudioWave, ControlButtons, SimulationTimer} from './components';

type Props = RootStackScreenProps<'SimulationAssistant'>;

export const SimulationAssistantScreen: React.FC<Props> = ({route}) => {
  const {roomData} = route.params;
  const wsUrl = 'wss://ally-learn-poc-dev-lbzgnlp9.livekit.cloud/';
  const token = roomData.access_token;
  const startTime = roomData?.created_at
    ? new Date(roomData?.created_at)
    : new Date();
  const navigation = useAppNavigation();
  const {t} = useTranslation();

  const [deleteRoom] = useDeleteRoomMutation();

  const [isConnecting, setIsConnecting] = useState<boolean>(false);
  const [isDisconnecting, setIsDisconnecting] = useState<boolean>(false);
  const [isMicEnabled, setIsMicEnabled] = useState<boolean>(false);

  const [room] = useState<Room>(() => new Room());

  useEffect(() => {
    if (token) {
      handleConnect();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const attachRoomListeners = useCallback(() => {
    const onConnected = () => {
      setIsConnecting(false);
      try {
        room.localParticipant.setMicrophoneEnabled(true);
        setIsMicEnabled(true);
      } catch {
        // no-op
      }
    };
    const onDisconnected = () => {
      setIsConnecting(false);
    };
    const onTrackPub = () => {
      // TODO: Handle track publication
    };
    room
      .on(RoomEvent.Connected, onConnected)
      .on(RoomEvent.Disconnected, onDisconnected)
      .on(RoomEvent.TrackPublished, onTrackPub);
    return () => {
      room
        .off(RoomEvent.Connected, onConnected)
        .off(RoomEvent.Disconnected, onDisconnected)
        .off(RoomEvent.TrackPublished, onTrackPub);
    };
  }, [room]);

  useEffect(() => attachRoomListeners(), [attachRoomListeners]);

  const handleConnect = useCallback(async () => {
    try {
      setIsConnecting(true);
      await room.connect(wsUrl, token);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to connect';
      console.error('handleConnect error', message);
    }
  }, [token, wsUrl]);

  const handleDisconnect = async () => {
    try {
      setIsDisconnecting(true);
      await room.disconnect();
      const response = await deleteRoom(room?.name);
      if (!response.error) {
        navigation.replace('SimulationFeedback');
      }
    } finally {
      setIsMicEnabled(false);
      setIsDisconnecting(false);
    }
  };

  const handleToggleMic = async () => {
    try {
      const next = !isMicEnabled;
      await room.localParticipant.setMicrophoneEnabled(next);
      setIsMicEnabled(next);
    } catch (e) {
      console.error('handleToggleMic error', e);
    }
  };

  const renderConnectionLoader = () => {
    return (
      <View style={styles.connectionLoaderContainer}>
        <Text>Connecting...</Text>
      </View>
    );
  };

  const renderDisconnectionLoader = () => {
    return (
      <View style={styles.connectionLoaderContainer}>
        <Text>Disconnecting...</Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <RoomContext.Provider value={room}>
        {isConnecting && renderConnectionLoader()}
        {isDisconnecting && renderDisconnectionLoader()}
        {startTime && <SimulationTimer startTime={startTime} />}
        <AudioWave />
        <ControlButtons
          onMicPress={handleToggleMic}
          onStopPress={handleDisconnect}
          isMuted={!isMicEnabled}
        />
        <View style={styles.securityContainer}>
          <InfoIcon width={12} height={12} color={colors.lightGray3} />
          <Text style={styles.securityText}>
            {t('SimulationScreen.encryptionInfo')}
          </Text>
        </View>
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
  connectionLoaderContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    zIndex: 1000,
  },
});
