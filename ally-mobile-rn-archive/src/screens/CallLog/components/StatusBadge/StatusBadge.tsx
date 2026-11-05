import React from 'react';
import {Text, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {HexagonCloseIcon} from '@/assets';
import {ChatSummaryStatus, SUMMARY_STATUS_CONFIG} from '@/constants';
import {useTranslate} from '@/hooks';
import {colors, fontFamily, typography} from '@/theme';

interface StatusBadgeProps {
  status: ChatSummaryStatus;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({status}) => {
  const {t} = useTranslate();

  if (status === ChatSummaryStatus.NO_AUDIO) {
    return (
      <View style={styles.statusContainer}>
        <HexagonCloseIcon />
        <Text style={styles.statusText}>{t('calls.status.noAudio')}</Text>
      </View>
    );
  }
  const config = SUMMARY_STATUS_CONFIG[status];

  return (
    <View
      style={[
        styles.statusContainer,
        {backgroundColor: config?.backgroundColor},
      ]}>
      <View style={[styles.statusDot, {backgroundColor: config?.dotColor}]} />
      <Text style={styles.statusText}>{config?.label}</Text>
    </View>
  );
};

const styles = ScaledSheet.create({
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: '8@ms',
    paddingVertical: '4@vs',
    borderRadius: '12@ms',
    gap: '4@vs',
  },
  statusDot: {
    width: '4@vs',
    height: '4@vs',
    borderRadius: '2@vs',
  },
  statusText: {
    fontFamily: fontFamily.IBM_PLEX_SERIF.REGULAR.fontFamily,
    ...typography.label.micro,
    color: colors.ds.typography.highEmphasis,
    textTransform: 'capitalize',
  },
});
