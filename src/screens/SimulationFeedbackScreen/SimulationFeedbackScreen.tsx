import React, {useMemo, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {SafeAreaView, Text, TouchableOpacity, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {LeftArrowIcon} from '@/assets';
import {CustomTabs, FeedbackPopup, useToast} from '@/components';
import {SCREEN_NAMES, USER_PERMISSIONS} from '@/constants';
import {useAppNavigation, useHardwareBackPressHandler} from '@/hooks';
import {RootStackScreenProps} from '@/navigation/types';
import {useAddSimulationFeedbackMutation} from '@/services';
import {useAppSelector} from '@/store/hooks';
import {colors, globalStyles} from '@/theme';
import {navigateToLearnTab} from '@/utils';

import {
  AskAI,
  ChecklistTab,
  Reflection,
  SessionSkills,
  SummaryTab,
  TranscriptTab,
  UpNext,
} from './components';
import {styles} from './styles';

// Tab keys enum for better maintainability and type safety
enum TabKey {
  SUMMARY = 'summary',
  ASK_AI = 'askAI',
  TRANSCRIPTION = 'transcription',
  CHECKLIST = 'checklist',
  SKILLS = 'skills',
  REFLECTION = 'reflection',
  UP_NEXT = 'upNext',
}

export const SimulationFeedbackScreen: React.FC<
  RootStackScreenProps<'SimulationFeedback'>
> = ({route}) => {
  const {fromLogs, scenarioSessionId, pathId, caseId} = route.params;
  const permissions = useAppSelector(state => state.user.permissions);
  const {t} = useTranslation();
  const insets = useSafeAreaInsets();

  const [activeTab, setActiveTab] = useState<number>(0);
  const [isFeedbackPopupVisible, setIsFeedbackPopupVisible] =
    useState<boolean>(false);

  const navigation = useAppNavigation();
  const [addSimulationFeedback] = useAddSimulationFeedbackMutation();
  const {showToast} = useToast();

  const handleBack = () => {
    if (pathId || caseId) {
      navigation.reset({
        index: 0,
        routes: [
          {
            name: pathId
              ? SCREEN_NAMES.SIMULATION_PATH_DETAILS
              : SCREEN_NAMES.CASE_DETAILS,
            params: pathId ? {pathId: pathId} : {caseId: caseId},
          },
        ],
      });
      return;
    }

    if (fromLogs) {
      navigation.goBack();
      return;
    }

    navigateToLearnTab(navigation);
  };

  const handleFeedbackAndNavigate = () => {
    handleBack();
    return true;
  };

  useHardwareBackPressHandler(handleFeedbackAndNavigate);

  const submitFeedback = async (
    rating: number,
    {comment}: {issues: string[]; comment: string},
  ) => {
    if (rating === 0) return;
    try {
      const response = await addSimulationFeedback({
        scenarioSessionId: scenarioSessionId?.toString() || '',
        rating,
        comment,
      });
      if (response.data) {
        showToast(t('Success.submitFeedback'), 'success');
      } else {
        showToast(t('Errors.submitFeedback'), 'error');
      }
    } catch (error) {
      showToast(t('Errors.submitFeedback'), 'error');
      hideFeedbackPopup();
    }
    handleBack();
  };

  const hideFeedbackPopup = () => {
    setIsFeedbackPopupVisible(false);
  };

  const handleSubmit = () => {
    setIsFeedbackPopupVisible(true);
  };

  const handleTabChange = (tabIndex: number) => {
    setActiveTab(tabIndex);
  };

  const renderTitle = () => {
    return (
      <Text style={styles.title}>
        {t('SimulationFeedback.title')}{' '}
        <Text style={styles.titleItalic}>
          {fromLogs
            ? t('CallSummary.header.subtitle')
            : t('SimulationFeedback.titleEnded')}
        </Text>
      </Text>
    );
  };
  const hasScenarioMessagesPermission = permissions?.includes(
    USER_PERMISSIONS.VIEW_SESSION_SCENARIO_MESSAGES,
  );

  const renderTabContent = () => {
    if (!hasScenarioMessagesPermission) {
      return null;
    }

    // Get the current tab key based on index
    const currentTabKey = tabs[activeTab]?.key;

    switch (currentTabKey) {
      case TabKey.SUMMARY:
        return (
          <SummaryTab
            scenarioSessionId={scenarioSessionId}
            pathId={pathId}
            caseId={caseId}
            fromLogs={fromLogs}
            onTryAnother={handleSubmit}
          />
        );

      case TabKey.ASK_AI:
        return <AskAI />;

      case TabKey.TRANSCRIPTION:
        return <TranscriptTab scenarioSessionId={scenarioSessionId} />;

      case TabKey.CHECKLIST:
        return <ChecklistTab scenarioSessionId={scenarioSessionId} />;

      case TabKey.SKILLS:
        return <SessionSkills scenarioSessionId={scenarioSessionId} />;

      case TabKey.REFLECTION:
        return <Reflection />;

      case TabKey.UP_NEXT:
        return (
          <UpNext
            scenarioSessionId={scenarioSessionId}
            pathId={pathId}
            caseId={caseId}
            onFinish={handleFeedbackAndNavigate}
            onBack={handleFeedbackAndNavigate}
          />
        );

      default:
        return null;
    }
  };

  // Build tabs array using enum keys for type safety
  const tabs = useMemo(() => {
    const tabsList = [
      {
        key: TabKey.SUMMARY,
        title: t('SimulationFeedback.tabs.summary'),
      },
      {
        key: TabKey.ASK_AI,
        title: t('SimulationFeedback.tabs.askAI'),
      },
      {
        key: TabKey.TRANSCRIPTION,
        title: t('SimulationFeedback.tabs.transcription'),
      },
      {
        key: TabKey.CHECKLIST,
        title: t('SimulationFeedback.tabs.checklist'),
      },
      {
        key: TabKey.SKILLS,
        title: t('SimulationFeedback.tabs.skills'),
      },
      {
        key: TabKey.REFLECTION,
        title: t('SimulationFeedback.tabs.reflection'),
      },
    ];

    // Only show "Up Next" tab for paths and cases
    if (pathId || caseId) {
      tabsList.push({
        key: TabKey.UP_NEXT,
        title: t('SimulationFeedback.tabs.upNext'),
      });
    }

    return tabsList;
  }, [t, pathId, caseId]);

  return (
    <SafeAreaView
      style={[
        styles.container,
        {paddingTop: insets.top, paddingBottom: insets.bottom},
      ]}>
      <View style={styles.titleSection}>
        <View style={styles.titleRow}>
          {fromLogs && (
            <TouchableOpacity
              onPress={handleFeedbackAndNavigate}
              style={styles.backArrowButton}>
              <LeftArrowIcon color={colors.black} />
            </TouchableOpacity>
          )}
          <View style={globalStyles.column}>
            {hasScenarioMessagesPermission && (
              <View style={!fromLogs && styles.titleExtraPadding}>
                {renderTitle()}
              </View>
            )}
          </View>
        </View>
      </View>
      {hasScenarioMessagesPermission && (
        <View style={styles.tabsContainer}>
          <CustomTabs
            tabs={tabs}
            activeTab={activeTab}
            onTabChange={handleTabChange}
            activeTabTextColor={colors.ds.theme.primary}
            inactiveTabTextColor={colors.ds.typography.lowEmphasis}
            activeTabBorderColor={colors.ds.theme.primary}
          />
        </View>
      )}
      {renderTabContent()}
      <FeedbackPopup
        visible={isFeedbackPopupVisible}
        onClose={hideFeedbackPopup}
        onSubmit={submitFeedback}
        showChips={false}
        placeholder={t('SimulationFeedback.placeholderText')}
        customTitle={t('SimulationFeedback.questionText')}
      />
    </SafeAreaView>
  );
};
