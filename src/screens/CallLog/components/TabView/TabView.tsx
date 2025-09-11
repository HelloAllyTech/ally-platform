import React from 'react';
import {Text, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {LogType} from '@/constants';
import {useTranslate} from '@/hooks';
import {colors, fontFamily} from '@/theme';

interface TabViewProps {
  activeTab: LogType;
  onTabChange: (tab: LogType) => void;
}

/**
 * TabView Component
 *
 * A tab component that allows switching between real call logs and simulation logs.
 * Displays two tabs with active/inactive states and smooth transitions.
 */
export const TabView: React.FC<TabViewProps> = ({activeTab, onTabChange}) => {
  const {t} = useTranslate();

  const tabs = [
    {key: LogType.REAL, label: t('CallLogs.realCallLogs')},
    {key: LogType.SIMULATION, label: t('CallLogs.simulations')},
  ];

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
    paddingHorizontal: '16@ms',
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
