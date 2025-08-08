import {Text, View} from 'react-native';
import {moderateScale, ScaledSheet} from 'react-native-size-matters';

import {BarsIcon, InfoIcon} from '@/assets/icons';
import {useTranslate} from '@/hooks';
import {useAppSelector} from '@/store/hooks';
import {colors, fontFamily} from '@/theme';

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
      <View style={styles.iconWrapper}>
        <BarsIcon width={moderateScale(89)} height={moderateScale(66)} />
      </View>
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
  iconWrapper: {
    width: '89@ms',
    height: '66@ms',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: '32@ms',
    marginTop: '33@vs',
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
    marginHorizontal: '24@ms',
    paddingBottom: '36@ms',
    marginBottom: '16@ms',
    borderBottomWidth: 0.5,
    borderBottomColor: colors.lightGray4,
  },
});
