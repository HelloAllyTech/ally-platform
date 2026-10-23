import React, {useCallback, useMemo, useState} from 'react';
import {
  ScrollView,
  ScrollViewProps,
  Text,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';

import type {ThemeMode} from '@/types';

import {getThemedStyles} from './styles';

export interface TabMeta {
  key: string;
  title: string;
}

export interface CustomTabsProps {
  tabs: TabMeta[];
  colorScheme?: ThemeMode;
  initialTab?: number;
  activeTab?: number;
  tabHeaderProps?: Partial<ScrollViewProps>;
  containerStyle?: ViewStyle;
  onTabChange?: (tabIndex: number) => void;
  renderTabHeader?: (
    tab: TabMeta,
    tabIndex: number,
    isActive: boolean,
    onPress: () => void,
  ) => React.ReactNode;
  // Custom style overrides
  activeTabTextColor?: string;
  inactiveTabTextColor?: string;
  activeTabBorderColor?: string;
}

export const CustomTabs = ({
  tabs,
  colorScheme = 'light',
  initialTab = 0,
  activeTab: controlledActiveTab,
  onTabChange,
  tabHeaderProps,
  renderTabHeader,
  containerStyle,
  activeTabTextColor,
  inactiveTabTextColor,
  activeTabBorderColor,
}: CustomTabsProps) => {
  const [internalActiveTab, setInternalActiveTab] = useState(initialTab);
  const activeTab = controlledActiveTab ?? internalActiveTab;
  const themedStyles = useMemo(
    () => getThemedStyles(colorScheme),
    [colorScheme],
  );

  const handleTabPress = useCallback(
    (tabIndex: number) => {
      setInternalActiveTab(tabIndex);
      if (onTabChange) onTabChange(tabIndex);
    },
    [onTabChange],
  );

  const tabHeaders = useMemo(
    () =>
      tabs.map((tab, tabIndex) => {
        const isActive = activeTab === tabIndex;
        const onPress = () => handleTabPress(tabIndex);
        if (renderTabHeader) {
          return (
            <React.Fragment key={tab.key}>
              {renderTabHeader(tab, tabIndex, isActive, onPress)}
            </React.Fragment>
          );
        }
        return (
          <TouchableOpacity
            key={tab.key}
            style={[
              themedStyles.tabButton,
              isActive && themedStyles.activeTabButton,
              isActive &&
                activeTabBorderColor && {
                  borderBottomColor: activeTabBorderColor,
                },
            ]}
            onPress={onPress}
            accessibilityRole="tab"
            accessibilityState={{selected: isActive}}
            accessibilityLabel={tab.title}>
            <Text
              style={[
                themedStyles.tabText,
                isActive && themedStyles.activeTabText,
                isActive && activeTabTextColor && {color: activeTabTextColor},
                !isActive &&
                  inactiveTabTextColor && {
                    color: inactiveTabTextColor,
                  },
              ]}>
              {tab.title}
            </Text>
          </TouchableOpacity>
        );
      }),
    [
      tabs,
      activeTab,
      renderTabHeader,
      themedStyles,
      activeTabBorderColor,
      activeTabTextColor,
      inactiveTabTextColor,
      handleTabPress,
    ],
  );

  return (
    <View style={[themedStyles.container, containerStyle]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={themedStyles.tabHeader}
        contentContainerStyle={themedStyles.tabHeaderContent}
        {...tabHeaderProps}>
        {tabHeaders}
      </ScrollView>
    </View>
  );
};
