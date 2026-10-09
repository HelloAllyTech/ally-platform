import React, {useEffect, useMemo, useState} from 'react';
import {Text, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {TickRoundIcon} from '@/assets';
import {Button, CustomDropdown, SimulationCard} from '@/components';
import {SCREEN_NAMES} from '@/constants';
import {useAppNavigation, useStartSimulation, useTranslate} from '@/hooks';
import {useGetCaseDetailsQuery, useGetScenarioByIdQuery} from '@/services';
import {colors} from '@/theme';
import {
  LanguageOption,
  StartCaseItemPayload,
  StartRoleplayItemPayload,
  TrackDetailItem,
  TrackItemType,
} from '@/types';
import {
  formatDate,
  getTriggerWarningNames,
  setActiveTrackContext,
} from '@/utils';

export interface RoleplayCasePlayerProps {
  payload: StartRoleplayItemPayload | StartCaseItemPayload;
  item: TrackDetailItem;
  trackId: string;
  alreadyCompleted: boolean;
}

/**
 * Pre-launch screen for roleplay and case items. Roleplay items launch a
 * live simulation (linked to the track item progress row via
 * `trackItemProgressId`); case items open the existing case detail screen.
 * Both stash the active-track context first so `CourseItemPlayerScreen` can
 * detect the return and refresh. Completion is reported out-of-band by the
 * existing simulation/case subsystem, exactly as on web — this component
 * never calls `onCompleted` itself. Mirrors ally-web's `RoleplayItemPlayer`
 * (the session-log-panel replay is a deliberate v1 scope-cut — completed
 * items just show a "Completed on {date}" chip).
 */
export const RoleplayCasePlayer: React.FC<RoleplayCasePlayerProps> = ({
  payload,
  item,
  trackId,
  alreadyCompleted,
}) => {
  const {t} = useTranslate();
  const navigation = useAppNavigation();
  const {startSimulation, isCreatingRoom} = useStartSimulation();

  const isCase = payload.type === TrackItemType.CASE;

  const {data: scenario} = useGetScenarioByIdQuery(
    {
      id: String(
        payload.type === TrackItemType.ROLEPLAY ? payload.scenarioId : 0,
      ),
    },
    {skip: isCase},
  );
  const {data: caseDetails} = useGetCaseDetailsQuery(
    {caseId: payload.type === TrackItemType.CASE ? payload.caseId : ''},
    {skip: !isCase},
  );

  // Same picker as the standalone simulation screen. The detail endpoint
  // carries `availableLanguages` for exactly this surface (a course item
  // reaches its scenario by id alone, never through the catalog list).
  const availableLanguages = useMemo<LanguageOption[]>(
    () => (isCase ? [] : (scenario?.availableLanguages ?? [])),
    [isCase, scenario?.availableLanguages],
  );
  const [selectedLanguage, setSelectedLanguage] =
    useState<LanguageOption | null>(null);
  const [isLanguageDropdownOpen, setIsLanguageDropdownOpen] = useState(false);

  // Default to the first offered language, but only while there is no valid
  // selection, so a refetch never silently reverts the learner's pick.
  useEffect(() => {
    if (!availableLanguages.length) {
      return;
    }
    const stillOffered =
      selectedLanguage !== null &&
      availableLanguages.some(lang => lang.label === selectedLanguage.label);
    if (!stillOffered) {
      setSelectedLanguage(availableLanguages[0]);
    }
  }, [availableLanguages, selectedLanguage]);

  const handleLanguageSelect = (selectedLabel: string) => {
    setSelectedLanguage(
      availableLanguages.find(lang => lang.label === selectedLabel) ?? null,
    );
  };

  const coverImageUrl = isCase
    ? caseDetails?.coverImageUrl
    : scenario?.coverImageUrl;
  // The item's own description is the player header's job (PlayerTopBar);
  // the card shows the scenario/case blurb.
  const description =
    (isCase ? caseDetails?.description : scenario?.description) || '';

  const launch = async () => {
    await setActiveTrackContext({trackId, itemId: item.id});

    if (payload.type === TrackItemType.CASE) {
      navigation.navigate(SCREEN_NAMES.CASE_DETAILS, {caseId: payload.caseId});
      return;
    }

    await startSimulation({
      scenarioId: payload.scenarioId,
      trackItemProgressId: payload.trackItemProgressId,
      ...(selectedLanguage?.language_id
        ? {languageId: selectedLanguage.language_id}
        : {}),
    });
  };

  const primaryLabel = isCase
    ? t('courses.roleplay.openCase')
    : alreadyCompleted
      ? t('courses.roleplay.replay')
      : t('courses.roleplay.start');

  return (
    <View style={styles.container}>
      <SimulationCard
        title={item.title}
        description={description}
        coverImageUrl={coverImageUrl}
        triggerWarnings={
          isCase ? undefined : getTriggerWarningNames(scenario?.triggerWarnings)
        }
        onPress={launch}
      />

      <Text style={styles.intro}>{t('courses.roleplay.intro')}</Text>

      {alreadyCompleted && item.completedAt && (
        <View style={styles.completedChip}>
          <TickRoundIcon width={16} height={16} color={colors.ds.green[700]} />
          <Text style={styles.completedChipText}>
            {t('courses.roleplay.completedOn', {
              date: formatDate(item.completedAt),
            })}
          </Text>
        </View>
      )}

      {availableLanguages.length > 0 && (
        <View style={styles.languageDropdownContainer}>
          <CustomDropdown
            value={selectedLanguage?.label ?? ''}
            options={availableLanguages.map(lang => lang.label)}
            onSelect={handleLanguageSelect}
            placeholder={t('nav.language.label')}
            isOpen={isLanguageDropdownOpen}
            setIsOpen={setIsLanguageDropdownOpen}
            disabled={isCreatingRoom}
          />
        </View>
      )}

      <Button
        testID="roleplay-case-launch"
        label={primaryLabel}
        onPress={launch}
        isLoading={isCreatingRoom}
      />
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: '16@ms',
    padding: '24@ms',
  },
  intro: {
    color: colors.ds.typography.mediumEmphasis,
    textAlign: 'center',
  },
  languageDropdownContainer: {
    alignSelf: 'stretch',
    // Keep the open menu above the launch button and card below it.
    zIndex: 10,
  },
  completedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '6@ms',
    backgroundColor: colors.ds.green[50],
    borderRadius: '20@ms',
    paddingHorizontal: '14@ms',
    paddingVertical: '8@ms',
  },
  completedChipText: {
    color: colors.ds.green[700],
  },
});
