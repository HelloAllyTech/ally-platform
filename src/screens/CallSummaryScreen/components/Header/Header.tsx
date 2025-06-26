import React from 'react';
import {
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {ArrowDown, LeftArrowIcon, ThreeDotsIcon} from '@/assets/icons';
import {DEFAULT_HIT_SLOP, isIOS} from '@/constants/general';
import useTranslate from '@/hooks/useTranslate';
import {colors} from '@/theme/colors';
import {fontFamily} from '@/theme/fonts';

interface HeaderProps {
  isFullyExpanded: boolean;
  onBackPress: () => void;
  onMenuPress: () => void;
  summaryName?: string;
  showAnimation: boolean;
  onHeaderPress: () => void;
  showSummary: boolean;
  showTranscript: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  isFullyExpanded,
  onBackPress,
  onMenuPress,
  summaryName = '',
  showAnimation,
  onHeaderPress,
  showSummary,
  showTranscript,
}) => {
  const {t} = useTranslate();

  if (!isFullyExpanded || !showAnimation) {
    return (
      <TouchableWithoutFeedback>
        <View style={styles.expandedTitleContainer}>
          <View style={styles.expandedTitleContent}>
            <View style={styles.expandedSummaryTitleContainer}>
              <TouchableOpacity
                style={styles.backButtonExpanded}
                onPress={onBackPress}>
                <LeftArrowIcon />
              </TouchableOpacity>
              <View>
                <TouchableOpacity
                  style={styles.summaryTitleContainer}
                  onPress={onHeaderPress}
                  activeOpacity={0.8}
                  disabled={!showTranscript}>
                  <Text style={styles.expandedSummaryTitle}>
                    {t('CallSummary.header.title')}{' '}
                    <Text style={styles.headerSubtitle}>
                      {showSummary
                        ? t('CallSummary.header.subtitle')
                        : t('CallSummary.header.transcript')}
                    </Text>
                  </Text>
                  {showTranscript && (
                    <View style={styles.arrowDownContainer}>
                      <ArrowDown width={9} height={5} />
                    </View>
                  )}
                </TouchableOpacity>
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
  }

  return (
    <View style={styles.header}>
      <TouchableOpacity style={styles.backButton} onPress={onBackPress}>
        <LeftArrowIcon />
      </TouchableOpacity>
      <Text style={styles.headerTitle}>
        {t('CallSummary.header.title')}{' '}
        <Text style={styles.headerSubtitle}>
          {t('CallSummary.header.subtitle')}
        </Text>
      </Text>
    </View>
  );
};

const styles = ScaledSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: '20@ms',
    paddingTop: '40@ms',
  },
  summaryTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  summaryNameContainer: {
    width: '100%',
    padding: '6@ms',
  },
  backButton: {
    backgroundColor: colors.ashGray,
    borderRadius: '22@ms',
    width: '44@ms',
    height: '44@ms',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: '12@ms',
    opacity: 0.8,
  },
  headerTitle: {
    ...fontFamily.REPLAY_PRO.HEADLINE,
    fontSize: '24@ms',
    color: colors.white,
    fontWeight: '400',
    lineHeight: '44@ms',
  },
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
    fontSize: '18@ms',
  },
  arrowDownContainer: {
    width: '24@ms',
    height: '24@ms',
    justifyContent: 'center',
    alignItems: 'center',
  },
  backButtonExpanded: {
    paddingLeft: '4@ms',
    paddingRight: '12@ms',
  },
  expandedTitleContainer: {
    backgroundColor: colors.white,
    paddingTop: '12@ms',
    height: '90@ms',
    zIndex: 1000,
    borderBottomWidth: 1,
    borderBottomColor: colors.ashGray,
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
    marginTop: '8@ms',
    marginBottom: '8@ms',
  },
  summaryNameText: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    fontSize: '14@ms',
    color: colors.charcoal2,
    marginRight: '10@ms',
  },
});
