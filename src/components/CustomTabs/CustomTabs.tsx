import React, {useCallback, useMemo, useState} from 'react';
import {
  AccessibilityRole,
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
    idx: number,
    isActive: boolean,
    onPress: () => void,
  ) => React.ReactNode;
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
}: CustomTabsProps) => {
  const [internalActiveTab, setInternalActiveTab] = useState(initialTab);
  const activeTab =
    controlledActiveTab !== undefined ? controlledActiveTab : internalActiveTab;
  const themedStyles = useMemo(
    () => getThemedStyles(colorScheme),
    [colorScheme],
  );

  const handleTabPress = useCallback(
    (idx: number) => {
      setInternalActiveTab(idx);
      if (onTabChange) onTabChange(idx);
    },
    [onTabChange],
  );

  const tabHeaders = useMemo(
    () =>
      tabs.map((tab, idx) => {
        const isActive = activeTab === idx;
        const onPress = () => handleTabPress(idx);
        if (renderTabHeader) {
          return (
            <React.Fragment key={tab.key}>
              {renderTabHeader(tab, idx, isActive, onPress)}
            </React.Fragment>
          );
        }
        return (
          <TouchableOpacity
            key={tab.key}
            style={[
              themedStyles.tabButton,
              isActive && themedStyles.activeTabButton,
            ]}
            onPress={onPress}
            accessibilityRole={'tab' as AccessibilityRole}
            accessibilityState={{selected: isActive}}
            accessibilityLabel={tab.title}>
            <Text
              style={[
                themedStyles.tabText,
                isActive && themedStyles.activeTabText,
              ]}>
              {tab.title}
            </Text>
          </TouchableOpacity>
        );
      }),
    [tabs, activeTab, themedStyles, renderTabHeader, handleTabPress],
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
