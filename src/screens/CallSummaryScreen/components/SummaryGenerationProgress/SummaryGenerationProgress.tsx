import {useCallback, useEffect, useMemo, useState} from 'react';
import LottieView from 'lottie-react-native';
import {Image, Text, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {
  animations,
  HexagonCloseIcon,
  ShieldWithTickIcon,
  summaryFailed,
  summaryGenerated,
} from '@/assets';
import {ShinyText} from '@/components';
import {
  ChatSummaryStatus,
  SUMMARY_GENERATION_STEPS,
  SummaryGenerationStep,
} from '@/constants';
import {useTranslate} from '@/hooks';
import {useAppSelector} from '@/store/hooks';
import {colors, fontFamily} from '@/theme';
import {getEstimatedSummaryGenerationTime} from '@/utils/callSummary';

export const SummaryGenerationProgress = ({
  summaryStatus,
  hideDescription = false,
}: {
  summaryStatus?: ChatSummaryStatus;
  hideDescription?: boolean;
}) => {
  const isSummaryGenerated = summaryStatus === ChatSummaryStatus.SUCCESS;
  const {t} = useTranslate();
  const currentChat = useAppSelector(state => state.chat.currentChat);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [hasCompletedAllSteps, setHasCompletedAllSteps] = useState(false);
  const [shouldShowGeneratedRow, setShouldShowGeneratedRow] = useState(false);
  const callDuration = useAppSelector(
    state => state.summary.summaryData?.details?.callDuration,
  );
  const estimatedTime = getEstimatedSummaryGenerationTime(callDuration || 0);

  const filteredSteps = useMemo(() => {
    return currentChat
      ? SUMMARY_GENERATION_STEPS
      : [...SUMMARY_GENERATION_STEPS.slice(8, SUMMARY_GENERATION_STEPS.length)];
  }, [currentChat]);

  const changeStep = useCallback(() => {
    if (currentStepIndex === filteredSteps.length - 1) {
      setHasCompletedAllSteps(true);
      return;
    }
    setCurrentStepIndex(prev => prev + 1);
  }, [currentStepIndex, filteredSteps]);

  useEffect(() => {
    const targetIndex = filteredSteps.findIndex(
      step => step === SummaryGenerationStep.SEGREGATING_UTTERANCES,
    );
    if (currentStepIndex === targetIndex && !shouldShowGeneratedRow)
      setShouldShowGeneratedRow(true);
  }, [currentStepIndex, filteredSteps, shouldShowGeneratedRow]);

  useEffect(() => {
    if (!shouldShowGeneratedRow) return;
    const id = setTimeout(() => setShouldShowGeneratedRow(false), 5000);

    return () => clearTimeout(id);
  }, [shouldShowGeneratedRow]);

  useEffect(() => {
    const stepInterval = setInterval(() => {
      if (!hasCompletedAllSteps) changeStep();
    }, 3000);

    return () => {
      clearInterval(stepInterval);
    };
  }, [changeStep, hasCompletedAllSteps]);

  if (
    summaryStatus &&
    [ChatSummaryStatus.FAILED, ChatSummaryStatus.NO_AUDIO].includes(
      summaryStatus,
    )
  ) {
    return (
      <View style={styles.container}>
        {summaryStatus === ChatSummaryStatus.NO_AUDIO && (
          <View style={[styles.noAudioTagWrapper]}>
            <HexagonCloseIcon />
            <Text style={[styles.generatedText, styles.colorBrickRed]}>
              {t('calls.status.noAudio')}
            </Text>
          </View>
        )}
        <Image source={summaryFailed} style={styles.marginV40} />
        <Text style={styles.title}>{t('summaryLoading.failedTitle')}</Text>
        <View style={styles.separator} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {shouldShowGeneratedRow && (
        <View style={styles.generatedRow}>
          <ShieldWithTickIcon />
          <Text style={styles.generatedText}>
            {t('summaryLoading.transcriptionDeleted')}
          </Text>
        </View>
      )}
      {isSummaryGenerated ? (
        <Image source={summaryGenerated} style={styles.marginV40} />
      ) : (
        <View style={styles.videoContainer}>
          <LottieView
            source={animations.summaryLoading}
            style={styles.video}
            autoPlay
            loop
            resizeMode="contain"
          />
        </View>
      )}

      {!isSummaryGenerated ? (
        <View style={styles.statusContainer}>
          <ShinyText style={styles.title}>
            {filteredSteps[currentStepIndex]}...
          </ShinyText>
        </View>
      ) : (
        <Text style={styles.title}>{t('summaryLoading.generated')}</Text>
      )}

      {!hideDescription && (
        <>
          <Text style={styles.subtitle}>
            {isSummaryGenerated
              ? t(`summaryLoading.generatedDesc`)
              : t(`summaryLoading.processingDescMain${currentChat ? '' : '2'}`)}
          </Text>
          {!isSummaryGenerated && (
            <Text style={styles.etaText}>
              {t('summaryLoading.estimatedTime', {time: estimatedTime})}
            </Text>
          )}
          <View style={styles.separator} />
        </>
      )}
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: '28@ms',
    backgroundColor: colors.white,
  },
  infoRow: {
    position: 'absolute',
    zIndex: 2,
    top: '18@ms',
    left: '16@ms',
    right: '16@ms',
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  infoText: {
    marginLeft: '8@ms',
    color: colors.darkSlate,
    fontSize: '14@ms',
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    opacity: 0.6,
  },
  videoContainer: {
    width: '100%',
    aspectRatio: 16 / 9,
    paddingHorizontal: '16@ms',
  },
  video: {
    width: '100%',
    height: '100%',
  },
  title: {
    ...fontFamily.REPLAY_PRO.BOLD,
    fontSize: '20@ms',
    color: colors.darkSlate,
    marginBottom: '12@ms',
    textAlign: 'center',
  },
  subtitle: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '16@ms',
    color: colors.darkSlate,
    opacity: 0.7,
    textAlign: 'center',
    marginHorizontal: '20@ms',
  },
  etaText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '12@ms',
    color: colors.mediumGray2,
    opacity: 0.8,
    marginTop: '16@ms',
  },
  separator: {
    width: '85%',
    height: 0.5,
    backgroundColor: colors.lightGray4,
    marginTop: '56@ms',
    marginBottom: '16@ms',
  },
  marginV40: {marginVertical: 40},
  statusContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: '8@ms',
    marginBottom: '24@ms',
  },
  generatedRow: {
    position: 'absolute',
    zIndex: 2,
    top: '2@ms',
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: '16@ms',
    paddingVertical: '4@vs',
    backgroundColor: colors.iceBlue,
    paddingHorizontal: '8@ms',
    borderWidth: 0.4,
    borderColor: colors.azureBlue,
    borderRadius: '16@s',
  },
  noAudioTagWrapper: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: '4@vs',
    paddingHorizontal: '8@ms',
    borderWidth: 0.4,
    borderColor: colors.brickRed,
    borderRadius: '16@s',
  },
  generatedText: {
    marginLeft: '8@ms',
    color: colors.azureBlue,
    fontSize: '14@ms',
    ...fontFamily.ROBOTO.REGULAR,
  },
  arrowIcon: {
    transform: [{rotate: '270deg'}],
  },
  settingUpText: {
    color: colors.black,
    opacity: 1,
  },
  colorBrickRed: {
    color: colors.brickRed,
  },
});
