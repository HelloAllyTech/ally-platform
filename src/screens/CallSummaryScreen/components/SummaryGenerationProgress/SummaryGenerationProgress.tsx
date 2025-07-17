import React from 'react';
import {RefreshControl, ScrollView, Text, View} from 'react-native';
import {moderateScale, ScaledSheet} from 'react-native-size-matters';

import {BarsIcon, InfoIcon} from '@/assets/icons';
import useTranslate from '@/hooks/useTranslate';
import {colors} from '@/theme/colors';
import {fontFamily} from '@/theme/fonts';

interface SummaryGenerationProgressProps {
  refreshing: boolean;
  onRefresh: () => void;
}

export const SummaryGenerationProgress: React.FC<
  SummaryGenerationProgressProps
> = ({refreshing, onRefresh}) => {
  const {t} = useTranslate();

  return (
    <ScrollView
      contentContainerStyle={styles.height100}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }>
      <View style={styles.container}>
        <View style={styles.infoRow}>
          <InfoIcon width={moderateScale(16)} height={moderateScale(16)} />
          <Text style={styles.infoText}>
            {t('CallSummaryProgress.reloadPage')}
          </Text>
        </View>
        <View style={styles.iconWrapper}>
          <BarsIcon width={moderateScale(89)} height={moderateScale(66)} />
        </View>
        <Text style={styles.title}>
          {t('CallSummaryProgress.generatingSessionSummary')}
        </Text>
        <Text style={styles.subtitle}>
          {t('CallSummaryProgress.generatingSubtitle')}
        </Text>
      </View>
    </ScrollView>
  );
};

const styles = ScaledSheet.create({
  container: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: '32@ms',
    paddingBottom: '400@ms',
    backgroundColor: colors.white,
    height: '100%',
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: '33@vs',
    marginTop: '8@ms',
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
    marginBottom: '16@ms',
  },
  height100: {
    height: '100%',
  },
});
