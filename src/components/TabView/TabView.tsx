import {Text, TextStyle, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {colors, fontFamily, typography} from '@/theme';

export interface GenericTabMeta<T extends string = string> {
  key: T;
  label: string;
}

export type TabWidthMode = 'equal' | 'content';

export interface TabViewProps<T extends string = string> {
  tabs: GenericTabMeta<T>[];
  activeTab: T;
  onTabChange: (tabKey: T) => void;
  /**
   * Controls how tabs distribute width:
   * - 'equal': Each tab takes equal width (default)
   * - 'content': Tabs fit their content size but can grow to fill container
   * @default 'equal'
   */
  tabWidthMode?: TabWidthMode;
  /**
   * Custom text style for tab labels
   */
  labelTextStyle?: TextStyle;
  /**
   * Custom text style for active tab label
   */
  activeLabelTextStyle?: TextStyle;
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
  tabWidthMode = 'equal',
  labelTextStyle,
  activeLabelTextStyle,
}: TabViewProps<T>) => {
  const isContentBased = tabWidthMode === 'content';

  return (
    <View style={styles.container}>
      {tabs.map(tab => (
        <TouchableOpacity
          key={tab.key}
          style={[
            styles.tab,
            isContentBased ? styles.tabContentBased : styles.tabEqual,
            activeTab === tab.key && styles.activeTab,
          ]}
          onPress={() => onTabChange(tab.key)}
          activeOpacity={0.7}>
          <Text
            numberOfLines={1}
            style={[
              styles.tabText,
              labelTextStyle,
              activeTab === tab.key && styles.activeTabText,
              activeTab === tab.key && activeLabelTextStyle,
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
    borderWidth: 0.5,
    borderColor: colors.lightGray4,
  },
  tab: {
    paddingVertical: '12@ms',
    paddingHorizontal: '4@ms',
    borderRadius: '7@ms',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabEqual: {
    flex: 1,
  },
  tabContentBased: {
    flexGrow: 1,
    flexShrink: 0,
  },
  activeTab: {
    backgroundColor: colors.white,
    borderWidth: 0.5,
    borderColor: colors.lightGray2,
  },
  tabText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.label.medium,
    color: colors.ds.typography.mediumEmphasis,
    textAlign: 'center',
  },
  activeTabText: {
    color: colors.ds.typography.highEmphasis,
  },
});
