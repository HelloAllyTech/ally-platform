import React from 'react';
import {Text, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {ANALYTICS_TABS} from '@/constants/analytics';
import {DEFAULT_HIT_SLOP} from '@/constants/general';
import {colors} from '@/theme/colors';
import {fontFamily} from '@/theme/fonts';

interface Props {
  selectedTab: string;
  onTabChange: (tab: string) => void;
}

export const TabBar: React.FC<Props> = ({selectedTab, onTabChange}) => (
  <View style={styles.tabBar}>
    {ANALYTICS_TABS.map(tab => (
      <TouchableOpacity
        key={tab}
        hitSlop={DEFAULT_HIT_SLOP}
        style={[
          styles.tabButton,
          selectedTab === tab && styles.tabButtonActive,
        ]}
        onPress={() => onTabChange(tab)}>
        <Text style={styles.tabText}>{tab}</Text>
      </TouchableOpacity>
    ))}
  </View>
);

const styles = ScaledSheet.create({
  tabBar: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: '12@s',
    padding: '8@s',
    paddingHorizontal: '10@s',
    width: '100%',
    borderRadius: '4@s',
    gap: '8@s',
    backgroundColor: colors.lightGray9,
  },
  tabButton: {
    paddingVertical: '4@s',
    paddingHorizontal: '18@s',
    borderRadius: '5@s',
    backgroundColor: 'transparent',
    borderColor: 'transparent',
  },
  tabButtonActive: {
    backgroundColor: colors.white,
    shadowColor: '#8B92E8',
    shadowOffset: {width: 0, height: 0},
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 2,
    borderWidth: 0.2,
    borderColor: 'rgba(175, 179, 229, 0.5)',
  },
  tabText: {
    fontSize: '12@ms',
    color: colors.black,
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
  },
});
