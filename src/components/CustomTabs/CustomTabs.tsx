import React, {useCallback, useMemo, useState} from 'react';
import {
  AccessibilityRole,
  FlatList,
  FlatListProps,
  ScrollView,
  ScrollViewProps,
  Text,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';

import type {ThemeMode} from '@/types/general';

import {getThemedStyles} from './styles';

export interface TabData<T> {
  key: string;
  title: string;
  data: T[];
}

export interface CustomTabsProps<T> {
  tabs: TabData<T>[];
  colorScheme?: ThemeMode;
  initialTab?: number;
  flatListProps?: Partial<FlatListProps<T>>;
  tabHeaderProps?: Partial<ScrollViewProps>;
  containerStyle?: ViewStyle;
  onTabChange?: (tabIndex: number) => void;
  renderItem: ({item}: {item: T}) => React.ReactElement;
  renderTabHeader?: (
    tab: TabData<T>,
    idx: number,
    isActive: boolean,
    onPress: () => void,
  ) => React.ReactNode;
}

function CustomTabs<T>({
  tabs,
  renderItem,
  colorScheme = 'light',
  initialTab = 0,
  onTabChange,
  flatListProps,
  tabHeaderProps,
  renderTabHeader,
  containerStyle,
}: CustomTabsProps<T>) {
  const [activeTab, setActiveTab] = useState(initialTab);
  const themedStyles = useMemo(
    () => getThemedStyles(colorScheme),
    [colorScheme],
  );

  const handleTabPress = useCallback(
    (idx: number) => {
      setActiveTab(idx);
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
      <FlatList
        data={tabs[activeTab]?.data || []}
        renderItem={renderItem}
        keyExtractor={(_, i) => `${tabs[activeTab]?.key ?? 'tab'}-${i}`}
        style={themedStyles.tabBody}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={themedStyles.tabBodyContent}
        {...flatListProps}
      />
    </View>
  );
}

export default CustomTabs;
