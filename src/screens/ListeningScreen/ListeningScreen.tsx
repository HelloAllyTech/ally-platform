import {useMemo} from 'react';
import {RouteProp} from '@react-navigation/native';

import {RootStackParamList} from '@/navigation';
import {useAppSelector} from '@/store/hooks';
import {ChatProvider} from '@/types';

import {ConferenceListeningScreen} from './ConferenceListeningScreen';
import {MicrophoneListeningScreen} from './MicrophoneListeningScreen';

interface ListeningScreenProps {
  route: RouteProp<RootStackParamList, 'Listening'>;
}

/**
 * Wrapper component that routes to the appropriate listening screen based on the call mode.
 *
 * Two modes:
 * 1. Microphone Mode: User records audio via device microphone
 * 2. Conference Mode: User listens to audio from conference call providers (Exotel/Ozonetel)
 */
export const ListeningScreen = ({route}: ListeningScreenProps) => {
  const chatData = useAppSelector(state => state.chat.currentChat);

  // Determine the mode based on route params or chat data
  const isMicrophoneMode = useMemo(() => {
    return (
      route.params?.isMicrophoneMode ||
      chatData?.provider === ChatProvider.MICROPHONE
    );
  }, [route.params?.isMicrophoneMode, chatData?.provider]);

  // Route to the appropriate screen
  if (isMicrophoneMode) {
    return <MicrophoneListeningScreen />;
  }

  return <ConferenceListeningScreen />;
};
