import React from 'react';
import {Text, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {colors} from '@/theme/colors';
import {fontFamily} from '@/theme/fonts';

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
    paddingVertical: '10@ms',
    paddingHorizontal: '10@ms',
  },
  sectionArrow: {
    fontSize: '16@ms',
    marginRight: '6@ms',
    color: colors.darkSlate,
    width: '18@ms',
    textAlign: 'center',
  },
  sectionTitle: {
    ...fontFamily.REPLAY_PRO.HEADLINE,
    fontSize: '16@ms',
    color: colors.darkSlate,
    fontWeight: '600',
  },
  iconContainer: {
    minWidth: '32@ms',
  },
});
