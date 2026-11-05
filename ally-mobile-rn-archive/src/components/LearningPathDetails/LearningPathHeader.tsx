import React from 'react';
import {Text, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {BoltIcon, LeftArrowIcon} from '@/assets';
import {colors, fontFamily, fontWeights, typography} from '@/theme';

interface LearningPathHeaderProps {
  title: string;
  onBackPress: () => void;
  credits?: {
    consumed: number;
    limit: number;
    isLow: boolean;
  };
}

export const LearningPathHeader: React.FC<LearningPathHeaderProps> = ({
  title,
  onBackPress,
  credits,
}) => {
  return (
    <View style={styles.header}>
      <TouchableOpacity onPress={onBackPress} style={styles.backButton}>
        <LeftArrowIcon color={colors.ds.typography.highEmphasis} />
      </TouchableOpacity>
      <Text style={styles.pageTitle}>{title}</Text>
      <View style={styles.headerSpacer} />
      {credits && (
        <View style={styles.creditDisplay}>
          <BoltIcon width={14} height={14} />
          <Text
            style={[styles.creditText, credits.isLow && styles.creditTextLow]}>
            {credits.consumed}
            <Text style={styles.creditLimitText}>/{credits.limit}</Text>
          </Text>
        </View>
      )}
    </View>
  );
};

const styles = ScaledSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '8@ms',
    marginBottom: '18@ms',
    marginHorizontal: '10@ms',
    paddingTop: '16@ms',
    paddingBottom: '8@ms',
    borderBottomWidth: 0.5,
    borderBottomColor: colors.ds.stroke.primary,
  },
  backButton: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  pageTitle: {
    ...fontFamily.REPLAY_PRO.HEADLINE,
    fontSize: '18@ms',
    color: colors.ds.typography.highEmphasis,
  },
  headerSpacer: {
    flex: 1,
  },
  creditDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '4@ms',
  },
  creditText: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.display.small,
    fontWeight: fontWeights.medium,
  },
  creditTextLow: {
    color: colors.ds.red[300],
  },
  creditLimitText: {
    ...typography.body.tiny,
    color: colors.darkGray,
  },
});
