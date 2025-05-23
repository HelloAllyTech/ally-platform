import React from 'react';
import {Text, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {LeftArrowIcon, ThreeDotsIcon} from '@/assets/icons';
import useTranslate from '@/hooks/useTranslate';
import {colors} from '@/theme/colors';
import {fontFamily} from '@/theme/fonts';
import {formatCallId} from '@/utils/callIdFormatter';

interface HeaderProps {
  isFullyExpanded: boolean;
  onBackPress: () => void;
  onMenuPress: () => void;
  callId?: string;
  createdAt?: string;
}

export const Header: React.FC<HeaderProps> = ({
  isFullyExpanded,
  onBackPress,
  onMenuPress,
  callId,
  createdAt,
}) => {
  const {t} = useTranslate();

  if (!isFullyExpanded) {
    return (
      <View style={styles.expandedTitleContainer}>
        <View style={styles.expandedTitleContent}>
          <View style={styles.expandedSummeryTitleContainer}>
            <TouchableOpacity
              style={styles.backButtonExpanded}
              onPress={onBackPress}>
              <LeftArrowIcon />
            </TouchableOpacity>
            <View>
              <Text style={styles.expandedSummeryTitle}>
                {t('CallSummary.header.title')}{' '}
                <Text style={styles.headerSubtitle}>
                  {t('CallSummary.header.subtitle')}
                </Text>
              </Text>
              <Text style={styles.expandedSubTitle}>
                {callId && createdAt
                  ? formatCallId(callId.toString(), createdAt)
                  : ''}
              </Text>
            </View>
          </View>
          <TouchableOpacity
            style={styles.moreOptionsContainer}
            onPress={onMenuPress}>
            <ThreeDotsIcon />
          </TouchableOpacity>
        </View>
      </View>
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
  },
  headerSubtitle: {
    fontStyle: 'italic',
    fontWeight: '500',
  },
  expandedSummeryTitleContainer: {
    flexDirection: 'row',
    height: '80@ms',
    alignItems: 'center',
  },
  expandedSummeryTitle: {
    ...fontFamily.REPLAY_PRO.HEADLINE,
    fontSize: '18@ms',
  },
  expandedSubTitle: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '13@ms',
    paddingTop: '4@ms',
    color: colors.black,
  },
  backButtonExpanded: {
    paddingLeft: '4@ms',
  },
  expandedTitleContainer: {
    backgroundColor: colors.white,
    height: '100@ms',
  },
  expandedTitleContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colors.ashGray,
  },
  moreOptionsContainer: {
    paddingRight: '20@ms',
  },
});
