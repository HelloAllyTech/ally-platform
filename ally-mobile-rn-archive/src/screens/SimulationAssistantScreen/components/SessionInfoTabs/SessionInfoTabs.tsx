import {FC, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {ScrollView, Text, TouchableOpacity, View} from 'react-native';
import Animated, {FadeIn, Layout} from 'react-native-reanimated';
import {ScaledSheet} from 'react-native-size-matters';

import {BulbIcon, NotesIcon} from '@/assets/icons';
import {RichText} from '@/components';
import {fontFamily} from '@/theme';

import {SessionInfoTab, SessionInfoTabsProps} from './types';

export const SessionInfoTabs: FC<SessionInfoTabsProps> = ({
  reminders = [],
  description,
  hideHeader = false,
  activeTab: controlledActiveTab,
  onTabChange,
}) => {
  const {t} = useTranslation();
  // Reminders is the primary tab, but land on Description while a scenario
  // has no reminders so the learner never opens onto an empty panel.
  const [internalActiveTab, setInternalActiveTab] = useState<SessionInfoTab>(
    reminders.length > 0 || !description
      ? SessionInfoTab.REMINDERS
      : SessionInfoTab.DESCRIPTION,
  );
  const activeTab = controlledActiveTab ?? internalActiveTab;
  const setActiveTab = onTabChange ?? setInternalActiveTab;

  if (reminders.length === 0 && !description) return null;

  const tabs = [
    {
      id: SessionInfoTab.REMINDERS,
      label: t('simulationPage.remindersTab'),
      Icon: BulbIcon,
    },
    {
      id: SessionInfoTab.DESCRIPTION,
      label: t('simulationPage.descriptionTab'),
      Icon: NotesIcon,
    },
  ];

  return (
    <Animated.View
      layout={Layout}
      entering={FadeIn}
      style={styles.container}
      testID="session-info-tabs">
      {/* Tab header */}
      {!hideHeader && (
        <View style={styles.header}>
          {tabs.map(tab => {
            const isActive = activeTab === tab.id;
            const {Icon} = tab;
            return (
              <TouchableOpacity
                key={tab.id}
                activeOpacity={0.7}
                testID={`session-info-tab-${tab.id}`}
                onPress={() => setActiveTab(tab.id)}
                style={styles.tabButton}>
                <Icon
                  width={16}
                  height={16}
                  color={isActive ? 'white' : '#9CA3AF'}
                />
                <Text
                  style={[styles.tabLabel, isActive && styles.tabLabelActive]}>
                  {tab.label}
                </Text>
                {isActive && <View style={styles.tabIndicator} />}
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {/* Tab content */}
      <ScrollView
        style={styles.contentContainer}
        showsVerticalScrollIndicator
        contentContainerStyle={styles.contentInner}>
        {activeTab === SessionInfoTab.REMINDERS &&
          (reminders.length > 0 ? (
            <View testID="session-info-reminders" style={styles.remindersList}>
              {reminders.map((reminder, index) => (
                <View key={index} style={styles.reminderCard}>
                  <Text style={styles.reminderText}>{reminder}</Text>
                </View>
              ))}
            </View>
          ) : (
            <Text
              testID="session-info-no-reminders"
              style={styles.emptyStateText}>
              {t('simulationPage.noRemindersYet')}
            </Text>
          ))}
        {activeTab === SessionInfoTab.DESCRIPTION && (
          <View testID="session-info-description">
            <RichText html={description} variant="dark" />
          </View>
        )}
      </ScrollView>
    </Animated.View>
  );
};

const styles = ScaledSheet.create({
  container: {
    backgroundColor: '#1d2020',
    borderRadius: '8@ms',
    padding: '10@ms',
    width: '100%',
    overflow: 'hidden',
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    gap: '16@ms',
    marginBottom: '12@vs',
    borderBottomWidth: 1,
    borderBottomColor: '#3D4045',
  },
  tabButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '6@ms',
    paddingVertical: '8@vs',
    paddingHorizontal: '4@ms',
  },
  tabLabel: {
    fontSize: '14@ms',
    fontWeight: '500',
    color: '#9CA3AF',
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
  },
  tabLabelActive: {
    color: 'white',
  },
  tabIndicator: {
    position: 'absolute',
    bottom: '-1@vs',
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: '#57f646',
    borderTopLeftRadius: '2@ms',
    borderTopRightRadius: '2@ms',
  },
  contentContainer: {
    flex: 1,
  },
  contentInner: {
    paddingBottom: '8@vs',
  },
  remindersList: {
    gap: '12@vs',
  },
  reminderCard: {
    backgroundColor: '#282B31',
    borderRadius: '16@ms',
    padding: '16@ms',
  },
  reminderText: {
    fontSize: '14@ms',
    color: 'white',
    lineHeight: '20@ms',
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
  },
  emptyStateText: {
    fontSize: '14@ms',
    color: '#9CA3AF',
    fontStyle: 'italic',
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
  },
});
