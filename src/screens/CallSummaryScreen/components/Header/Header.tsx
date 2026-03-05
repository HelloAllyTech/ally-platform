import React from 'react';
import {
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {LeftArrowIcon, ThreeDotsIcon} from '@/assets/icons';
import {DEFAULT_HIT_SLOP, isIOS} from '@/constants/general';
import {useTranslate} from '@/hooks';
import {colors, fontFamily, typography} from '@/theme';

interface HeaderProps {
  onBackPress: () => void;
  onMenuPress: () => void;
  summaryName?: string;
}

export const Header: React.FC<HeaderProps> = ({
  onBackPress,
  onMenuPress,
  summaryName = '',
}) => {
  const {t} = useTranslate();

  return (
    <TouchableWithoutFeedback>
      <View style={styles.expandedTitleContainer}>
        <View style={styles.expandedTitleContent}>
          <View style={styles.expandedSummaryTitleContainer}>
            <TouchableOpacity
              style={styles.backButtonExpanded}
              onPress={onBackPress}>
              <LeftArrowIcon color={colors.black} />
            </TouchableOpacity>
            <View>
              <Text style={styles.expandedSummaryTitle}>
                {t('CallSummary.header.title')}{' '}
                <Text style={styles.headerSubtitle}>
                  {t('CallSummary.header.subtitle')}
                </Text>
              </Text>
              <View style={styles.nameContainer}>
                <Text numberOfLines={1} style={styles.summaryNameText}>
                  {summaryName ? `#${summaryName}` : '-'}
                </Text>
              </View>
            </View>
          </View>
          <TouchableOpacity
            hitSlop={DEFAULT_HIT_SLOP}
            style={styles.moreOptionsContainer}
            onPress={onMenuPress}>
            <ThreeDotsIcon />
          </TouchableOpacity>
        </View>
      </View>
    </TouchableWithoutFeedback>
  );
};

const styles = ScaledSheet.create({
  headerSubtitle: {
    ...fontFamily.REPLAY_PRO.BOLD_ITALIC,
    fontStyle: isIOS ? 'italic' : 'normal',
    fontWeight: '500',
  },
  expandedSummaryTitleContainer: {
    flexDirection: 'row',
    height: '80@ms',
    alignItems: 'center',
    maxWidth: '80%',
  },
  expandedSummaryTitle: {
    ...fontFamily.REPLAY_PRO.HEADLINE,
    ...typography.headline.tiny,
    color: colors.ds.typography.highEmphasis,
  },
  backButtonExpanded: {
    paddingLeft: '4@ms',
    paddingRight: '12@ms',
  },
  expandedTitleContainer: {
    backgroundColor: colors.white,
    zIndex: 1000,
  },
  expandedTitleContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  moreOptionsContainer: {
    paddingRight: '20@ms',
  },
  nameContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: isIOS ? '3@ms' : '0@ms',
  },
  summaryNameText: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.body.medium,
    color: colors.ds.typography.mediumEmphasis,
    marginRight: '10@ms',
  },
});
