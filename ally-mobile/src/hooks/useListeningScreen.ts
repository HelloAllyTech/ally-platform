import {useMemo} from 'react';

import {AllyPlatforms} from '@/constants';
import {ChatProvider, ConferenceCallProviders} from '@/types';
import {Maybe} from '@/utils';

import {useTranslate} from './useTranslate';

interface Chat {
  provider?: ChatProvider;
  platform?: AllyPlatforms;
  startedAt?: string;
  chatId?: number;
}

interface UseListeningScreenParams {
  isMicrophoneMode: boolean;
  isFocusMode: boolean;
  chatData: Maybe<Chat>;
}

export const useListeningScreen = ({
  isFocusMode,
  chatData,
}: UseListeningScreenParams) => {
  const {t} = useTranslate();

  const callProvider = chatData?.provider;

  // Computed call mode flags
  const isWebMicrophoneMode = useMemo(
    () =>
      callProvider === ChatProvider.MICROPHONE &&
      chatData?.platform === AllyPlatforms.WEB,
    [callProvider, chatData?.platform],
  );

  const isConferenceCall = useMemo(
    () => callProvider && ConferenceCallProviders.includes(callProvider),
    [callProvider],
  );

  // Tooltip content
  const tooltipContentList = useMemo(
    () => [
      t('audioCall.privacy.noRecording'),
      t('audioCall.privacy.encrypted'),
      t('audioCall.privacy.noTrainingData'),
      t('audioCall.privacy.personalInfoRemoved'),
    ],
    [t],
  );

  // Tooltip display insets based on focus mode
  const tooltipDisplayInsets = useMemo(
    () => ({
      left: isFocusMode ? 40 : 10,
      right: isFocusMode ? 40 : 10,
      top: 10,
      bottom: 10,
    }),
    [isFocusMode],
  );

  // Calculate start time from chat data
  const startTime = useMemo(
    () =>
      chatData?.startedAt ? new Date(chatData.startedAt).getTime() : Date.now(),
    [chatData?.startedAt],
  );

  return {
    // Call mode flags
    isWebMicrophoneMode,
    isConferenceCall,
    callProvider,

    // Tooltip data
    tooltipContentList,
    tooltipDisplayInsets,

    // Timing
    startTime,
  };
};
