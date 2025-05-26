import React from 'react';
import {Text, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {colors} from '@/theme/colors';
import {fontFamily} from '@/theme/fonts';
import {typography} from '@/theme/typography';

interface SectionHeaderProps {
  label: string;
  isExpanded: boolean;
  onToggle: () => void;
  icon: React.ReactNode;
}

export const SectionHeader: React.FC<SectionHeaderProps> = ({
  label,
  isExpanded,
  onToggle,
  icon,
}) => {
  return (
    <TouchableOpacity
      style={styles.sectionHeader}
      onPress={onToggle}
      activeOpacity={0.7}>
      <Text style={styles.sectionArrow}>{isExpanded ? '▼' : '▶'}</Text>
      <View style={styles.iconContainer}>{icon}</View>
      <Text style={styles.sectionTitle}>{label}</Text>
    </TouchableOpacity>
  );
};

const styles = ScaledSheet.create({
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: '16@ms',
    paddingBottom: '12@ms',
    paddingHorizontal: '10@ms',
    width: '100%',
    flex: 1,
  },
  sectionArrow: {
    fontSize: '16@ms',
    marginRight: '10@ms',
    color: colors.darkSlate,
    width: '18@ms',
    textAlign: 'center',
  },
  sectionTitle: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    color: colors.black,
    width: '85%',
  },
  iconContainer: {
    marginRight: '8@ms',
  },
});
