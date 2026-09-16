import React from 'react';
import {
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {LeftArrowIcon, ThreeDotsIcon} from '@/assets/icons';
import {CustomSwitch} from '@/components';
import {DEFAULT_HIT_SLOP, isIOS} from '@/constants/general';
import {useTranslate} from '@/hooks';
import {colors, fontFamily, typography} from '@/theme';

interface HeaderProps {
  onBackPress: () => void;
  onMenuPress: () => void;
  summaryName?: string;
  mode?: string;
  showShareSwitch?: boolean;
  isSharedForReview?: boolean;
  onShareToggle?: (isEnabled: boolean) => void;
}

export const Header: React.FC<HeaderProps> = ({
  onBackPress,
  onMenuPress,
  summaryName = '',
  mode: _mode,
  showShareSwitch = false,
  isSharedForReview = false,
  onShareToggle,
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
                {t('callSummary.header.title')}{' '}
                <Text style={styles.headerSubtitle}>
                  {t('callSummary.header.subtitle')}
                </Text>
              </Text>
              <View style={styles.nameContainer}>
                <Text numberOfLines={1} style={styles.summaryNameText}>
                  {summaryName ? `#${summaryName}` : '-'}
                </Text>
              </View>
            </View>
          </View>
          <View style={styles.headerRightContainer}>
            {showShareSwitch && onShareToggle && (
              <View style={styles.shareSwitchContainer}>
                <Text style={styles.shareSwitchLabel}>
                  {t('learn.scenario.share')}
                </Text>
                <CustomSwitch
                  value={isSharedForReview}
                  onToggle={onShareToggle}
                />
              </View>
            )}
            <TouchableOpacity
              hitSlop={DEFAULT_HIT_SLOP}
              style={styles.moreOptionsContainer}
              onPress={onMenuPress}>
              <ThreeDotsIcon />
            </TouchableOpacity>
          </View>
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
  shareSwitchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '8@ms',
  },
  shareSwitchLabel: {
    ...typography.body.small,
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    color: colors.ds.typography.lowEmphasis,
  },
  headerRightContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '16@ms',
  },
  modeBadge: {
    backgroundColor: '#E8EAF6',
    paddingHorizontal: '8@ms',
    paddingVertical: '2@ms',
    borderRadius: '10@ms',
  },
  modeBadgeText: {
    ...typography.body.small,
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    color: '#3949AB',
    fontSize: '10@ms',
  },
});
