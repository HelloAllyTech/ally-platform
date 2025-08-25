import {useCallback, useEffect, useMemo, useState} from 'react';
import {ActivityIndicator, Image, Text, View} from 'react-native';
import {moderateScale, ScaledSheet} from 'react-native-size-matters';
import Video from 'react-native-video';

import {
  LeftArrowIcon,
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

export const SummaryGenerationProgress = ({
  isSummaryGenerated,
  isPollingComplete = false,
  summaryStatus,
}: {
  isSummaryGenerated: boolean;
  isPollingComplete?: boolean;
  summaryStatus?: ChatSummaryStatus;
}) => {
  const {t} = useTranslate();
  const currentChat = useAppSelector(state => state.chat.currentChat);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [hasCompletedAllSteps, setHasCompletedAllSteps] = useState(false);
  const [shouldShowGeneratedRow, setShouldShowGeneratedRow] = useState(false);

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

  const renderNotificationInfo = () => {
    if (isSummaryGenerated)
      return (
        <View style={styles.infoRow}>
          <ActivityIndicator size="small" color={colors.azureBlue} />
          <Text style={[styles.infoText, styles.settingUpText]}>
            {t('CallSummaryProgress.settingUpSummaryScreen')}
          </Text>
        </View>
      );

    if (isPollingComplete) {
      return (
        <View style={styles.infoRow}>
          <LeftArrowIcon
            color={colors.darkGray}
            width={moderateScale(16)}
            height={moderateScale(16)}
            style={styles.arrowIcon}
          />
          <Text style={styles.infoText}>
            {t('CallSummaryProgress.pullDown')}
          </Text>
        </View>
      );
    } else if (shouldShowGeneratedRow) {
      return (
        <View style={styles.generatedRow}>
          <ShieldWithTickIcon />
          <Text style={styles.generatedText}>
            {t('CallSummaryProgress.transcriptionGeneratedAudioDeleted')}
          </Text>
        </View>
      );
    }
  };

  if (summaryStatus && summaryStatus === ChatSummaryStatus.FAILED) {
    return (
      <View style={styles.container}>
        <Image source={summaryFailed} style={styles.marginV40} />
        <Text style={[styles.title, styles.width80]}>
          {t('CallSummaryProgress.summaryGenerationFailed')}
        </Text>
        <View style={styles.separator} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {renderNotificationInfo()}
      {isSummaryGenerated ? (
        <Image source={summaryGenerated} style={styles.marginV40} />
      ) : (
        <View style={styles.videoContainer}>
          <Video
            source={require('@/assets/videos/summaryLoading.mp4')}
            style={styles.video}
            repeat
            muted
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
        <Text style={styles.title}>
          {t('CallSummaryProgress.generatedSessionSummary')}
        </Text>
      )}

      <Text style={styles.subtitle}>
        {isSummaryGenerated
          ? t(`CallSummaryProgress.generatedSubtitle`)
          : t(
              `CallSummaryProgress.generatingSubtitle${currentChat ? '' : '2'}`,
            )}
      </Text>
      {!isSummaryGenerated && (
        <Text style={styles.etaText}>
          {t('CallSummaryProgress.estimatedTime')}
        </Text>
      )}
      <View style={styles.separator} />
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
  width80: {
    width: '80%',
  },
});
