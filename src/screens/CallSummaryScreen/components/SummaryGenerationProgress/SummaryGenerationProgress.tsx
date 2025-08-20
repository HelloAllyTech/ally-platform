import {Image, Text, View} from 'react-native';
import {moderateScale, ScaledSheet} from 'react-native-size-matters';
import Video from 'react-native-video';

import {InfoIcon, summaryGenerated} from '@/assets';
import {useTranslate} from '@/hooks';
import {useAppSelector} from '@/store/hooks';
import {colors, fontFamily} from '@/theme';

import {SummaryStatusTexts} from './SummaryStatusTexts';

export const SummaryGenerationProgress = ({
  isSummaryGenerated,
  isPollingComplete = false,
}: {
  isSummaryGenerated: boolean;
  isPollingComplete?: boolean;
}) => {
  const {t} = useTranslate();
  const currentChat = useAppSelector(state => state.chat.currentChat);

  return (
    <View style={styles.container}>
      {!isSummaryGenerated && isPollingComplete && (
        <View style={styles.infoRow}>
          <InfoIcon width={moderateScale(16)} height={moderateScale(16)} />
          <Text style={styles.infoText}>
            {t('CallSummaryProgress.reloadPage')}
          </Text>
        </View>
      )}

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

      {!isSummaryGenerated && <SummaryStatusTexts />}

      <Text style={styles.title}>
        {isSummaryGenerated
          ? t('CallSummaryProgress.generatedSessionSummary')
          : t('CallSummaryProgress.generatingSessionSummary')}
      </Text>
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
    flexDirection: 'row',
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
    marginTop: '16@vs',
  },
  video: {
    width: '100%',
    height: '100%',
  },
  title: {
    ...fontFamily.REPLAY_PRO.HEADLINE,
    fontSize: '20@ms',
    color: colors.darkSlate,
    fontWeight: '700',
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
});
