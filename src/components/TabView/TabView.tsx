import {Text, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {colors, fontFamily} from '@/theme';

export interface GenericTabMeta<T extends string = string> {
  key: T;
  label: string;
}

export interface TabViewProps<T extends string = string> {
  tabs: GenericTabMeta<T>[];
  activeTab: T;
  onTabChange: (tabKey: T) => void;
}

/**
 * Generic TabView Component (pill-style header)
 *
 * Usage sites fully control tab keys and labels.
 */
export const TabView = <T extends string = string>({
  tabs,
  activeTab,
  onTabChange,
}: TabViewProps<T>) => {
  return (
    <View style={styles.container}>
      {tabs.map(tab => (
        <TouchableOpacity
          key={tab.key}
          style={[styles.tab, activeTab === tab.key && styles.activeTab]}
          onPress={() => onTabChange(tab.key)}
          activeOpacity={0.7}>
          <Text
            style={[
              styles.tabText,
              activeTab === tab.key && styles.activeTabText,
            ]}>
            {tab.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: colors.lightGray19,
    borderRadius: '8@ms',
    marginHorizontal: '20@ms',
    marginVertical: '16@ms',
    borderWidth: 0.5,
    borderColor: colors.lightGray4,
  },
  tab: {
    flex: 1,
    paddingVertical: '12@ms',
    paddingLeft: '4@ms',
    paddingRight: '2@ms',
    borderRadius: '7@ms',
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeTab: {
    backgroundColor: colors.white,
    borderWidth: 0.5,
    borderColor: colors.lightGray2,
  },
  tabText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '14@ms',
    lineHeight: '18@ms',
    color: colors.darkGray2,
  },
  activeTabText: {
    color: colors.darkSlate,
  },
});
