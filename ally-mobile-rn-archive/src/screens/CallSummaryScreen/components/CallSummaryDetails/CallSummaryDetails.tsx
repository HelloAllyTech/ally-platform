import React, {memo, useCallback, useEffect, useRef, useState} from 'react';
import {ActivityIndicator, Text, View} from 'react-native';
import {KeyboardAwareScrollView} from 'react-native-keyboard-aware-scroll-view';
import {ScaledSheet} from 'react-native-size-matters';

import {GoldenShieldIcon} from '@/assets';
import {Button, useToast} from '@/components';
import {
  ALWAYS_VISIBLE_SECTIONS,
  SECTION_LIST,
  SectionKey,
  summaryFields,
} from '@/constants';
import {useCallSummaryForm, useTranslate} from '@/hooks';
import {
  CustomFieldValue,
  useGetCustomFieldDefinitionsQuery,
  useGetCustomFieldsEnabledQuery,
  useGetCustomFieldValuesQuery,
  useUpsertCustomFieldValuesMutation,
} from '@/services/customFieldsApi';
import {useAppSelector} from '@/store/hooks';
import {selectSummaryVisibleFields} from '@/store/slices/summarySlice';
import {colors, fontFamily, typography} from '@/theme';
import {SectionItem} from '@/types';

import {SectionWrapper} from '../SectionWrapper/SectionWrapper';

interface Props {
  isLoading: boolean;
  onSubmit: (isUpdateSuccess: boolean) => void;
  showSaveButton: boolean;
  chatId?: number;
}

const CallSummaryDetailsComponent: React.FC<Props> = ({
  isLoading: isLoadingSummary,
  onSubmit,
  showSaveButton,
  chatId,
}) => {
  const {t} = useTranslate();
  const {showToast} = useToast();
  const visibleFields = useAppSelector(selectSummaryVisibleFields);
  const {isUpdating, handleSubmit} = useCallSummaryForm();

  const {data: customFieldsEnabled} = useGetCustomFieldsEnabledQuery();
  const customFieldsActive = customFieldsEnabled !== false;

  const {data: customFieldDefs} = useGetCustomFieldDefinitionsQuery(undefined, {
    skip: !customFieldsActive,
  });

  const {data: customFieldValues} = useGetCustomFieldValuesQuery(chatId!, {
    skip: !chatId || !customFieldsActive,
    // Values can change server-side after the screen was last cached — an
    // async AI fill lands seconds after the call, or another user edits them.
    // The mutation has no cache tags, so without this a re-open would show
    // stale/empty values until the cache expired. The once-per-chat seed guard
    // below keeps a fresh fetch from clobbering in-progress edits.
    refetchOnMountOrArgChange: true,
  });

  const [upsertCustomFieldValues] = useUpsertCustomFieldValuesMutation();

  const [customLocalValues, setCustomLocalValues] = useState<
    Record<string, string | null>
  >({});
  // Fields the user has actually edited in this visit. Saving must only ever
  // send these — diffing customLocalValues against the live customFieldValues
  // query instead would re-include any field whose server value drifted for a
  // reason unrelated to this user (another editor, a background AI fill) and
  // silently write the stale locally-seeded value back over it.
  const [dirtyFieldIds, setDirtyFieldIds] = useState<Set<string>>(new Set());
  const seededChatIdRef = useRef<number | null>(null);

  // Seed local edit state once per chat. Re-seeding on every customFieldValues
  // change would clobber the user's in-progress edits: a background refetch
  // resets typed values back to the stale server value before the user saves.
  useEffect(() => {
    if (customFieldValues && seededChatIdRef.current !== chatId) {
      const initial: Record<string, string | null> = {};
      customFieldValues.forEach((f: CustomFieldValue) => {
        initial[f.fieldDefinitionId] = f.value ?? null;
      });
      setCustomLocalValues(initial);
      setDirtyFieldIds(new Set());
      seededChatIdRef.current = chatId ?? null;
    }
  }, [customFieldValues, chatId]);

  const handleCustomFieldChange = useCallback(
    (fieldDefinitionId: string, value: string | null) => {
      setCustomLocalValues(prev => ({...prev, [fieldDefinitionId]: value}));
      setDirtyFieldIds(prev => new Set(prev).add(fieldDefinitionId));
    },
    [],
  );

  const handleCustomFieldSave = useCallback(
    async (sectionKey: string) => {
      if (!chatId || !customFieldDefs) return;
      const sectionDefIds = new Set(
        customFieldDefs.filter(d => d.sectionKey === sectionKey).map(d => d.id),
      );
      const changed = Array.from(dirtyFieldIds)
        .filter(id => sectionDefIds.has(id))
        .map(fieldDefinitionId => ({
          fieldDefinitionId,
          // Coalesce to null, not undefined: clearing a field stores null
          // locally, but JSON.stringify drops undefined keys, so the PUT body
          // omitted `value` entirely and the backend (which skips undefined
          // properties on save) left the column untouched — the cleared value
          // reappeared on reopen.
          value: customLocalValues[fieldDefinitionId] ?? null,
        }));
      if (changed.length > 0) {
        const result = await upsertCustomFieldValues({chatId, values: changed});
        // A failed save must not be marked clean — clearing dirtyFieldIds here
        // regardless of outcome silently discarded the edit: the field looked
        // saved (no way to detect or retry it) even though the write never
        // reached the backend.
        if ('error' in result) {
          showToast(t('summary.customFieldSaveFailed'), 'error');
          return;
        }
        setDirtyFieldIds(prev => {
          const next = new Set(prev);
          changed.forEach(c => next.delete(c.fieldDefinitionId));
          return next;
        });
      }
    },
    [
      chatId,
      customFieldDefs,
      dirtyFieldIds,
      customLocalValues,
      upsertCustomFieldValues,
      showToast,
      t,
    ],
  );

  const [expanded, setExpanded] = useState(() =>
    SECTION_LIST.reduce(
      (acc, section) => {
        acc[section.key] = false;
        return acc;
      },
      {} as Record<SectionKey, boolean>,
    ),
  );

  const [isEditing, setIsEditing] = useState(() =>
    SECTION_LIST.reduce(
      (acc, section) => {
        acc[section.key] = false;
        return acc;
      },
      {} as Record<SectionKey, boolean>,
    ),
  );

  const onSubmitButtonPress = useCallback(async () => {
    const response = await handleSubmit();
    onSubmit(Boolean(response?.data));
  }, [handleSubmit, onSubmit]);

  const toggleSection = useCallback(
    (key: SectionKey) => {
      // Check if any section is currently being edited
      const isAnyEditing = Object.values(isEditing).some(editing => editing);
      const isCurrentSectionEditing = isEditing[key];

      // If another section is being edited and this is not the current section, prevent toggle
      if (isAnyEditing && !isCurrentSectionEditing) {
        return;
      }

      // If the current section is being edited, exit editing mode
      if (isCurrentSectionEditing) {
        setIsEditing(prev => ({...prev, [key]: false}));
      }

      setExpanded(prev => {
        const isCurrentlyExpanded = prev[key];

        // If the section is currently expanded, just close it
        if (isCurrentlyExpanded) {
          return {...prev, [key]: false};
        }

        // If the section is currently closed, close all other sections and open this one
        const newExpanded = Object.keys(prev).reduce(
          (acc, sectionKey) => {
            acc[sectionKey as SectionKey] = sectionKey === key;
            return acc;
          },
          {} as Record<SectionKey, boolean>,
        );

        return newExpanded;
      });
    },
    [isEditing],
  );

  const renderSection = useCallback(
    (sectionConfig: SectionItem, index: number) => {
      if (!ALWAYS_VISIBLE_SECTIONS.includes(sectionConfig.key)) {
        const hasVisibleFields = visibleFields?.some(
          field =>
            summaryFields.find(summaryField => summaryField.key === field)
              ?.sectionKey === sectionConfig.key,
        );

        if (!hasVisibleFields) {
          return null;
        }
      }
      const Icon = sectionConfig.icon;

      return (
        <View key={sectionConfig.key}>
          <SectionWrapper
            label={t(sectionConfig.labelKey)}
            isExpanded={expanded[sectionConfig.key]}
            onToggle={() => toggleSection(sectionConfig.key)}
            icon={<Icon />}
            sectionConfig={sectionConfig}
            index={index}
            handleSubmit={handleSubmit}
            isEditing={isEditing[sectionConfig.key]}
            setIsEditing={setIsEditing}
            customFieldDefs={customFieldDefs}
            customFieldLocalValues={customLocalValues}
            onCustomFieldChange={handleCustomFieldChange}
            onCustomFieldSave={handleCustomFieldSave}
          />
        </View>
      );
    },
    [
      t,
      expanded,
      isEditing,
      handleSubmit,
      toggleSection,
      visibleFields,
      customFieldDefs,
      customLocalValues,
      handleCustomFieldChange,
      handleCustomFieldSave,
    ],
  );

  if (isLoadingSummary) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.darkSlate} />
      </View>
    );
  }

  return (
    <>
      <KeyboardAwareScrollView
        style={styles.container}
        contentContainerStyle={styles.contentContainer}
        nestedScrollEnabled
        extraScrollHeight={150}
        keyboardShouldPersistTaps="handled"
        enableOnAndroid>
        <View style={styles.alertContainer}>
          <View style={styles.alertIconContainer}>
            <GoldenShieldIcon />
          </View>
          <Text style={styles.alertText}>
            {t('callSummary.aiGeneratedWarning')}
          </Text>
        </View>
        <View style={styles.card}>{SECTION_LIST.map(renderSection)}</View>
      </KeyboardAwareScrollView>
      {showSaveButton && (
        <View style={styles.buttonContainer}>
          <Button
            label={t('common.save')}
            onPress={onSubmitButtonPress}
            isLoading={isUpdating}
            customContainerStyle={styles.submitButton}
            customTextStyle={styles.submitButtonText}
          />
        </View>
      )}
    </>
  );
};

export const CallSummaryDetails = memo(CallSummaryDetailsComponent);

const styles = ScaledSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.white,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.white,
  },
  contentContainer: {
    paddingBottom: '70@ms',
  },
  card: {
    paddingHorizontal: '16@s',
    backgroundColor: colors.white,
    marginBottom: '20@ms',
    paddingTop: '8@ms',
  },
  sectionContent: {
    paddingLeft: '30@ms',
  },
  buttonContainer: {
    position: 'absolute',
    bottom: '3@ms',
    left: 0,
    right: 0,
    zIndex: 1000,
    alignItems: 'center',
    paddingTop: '20@ms',
    paddingBottom: '20@ms',
    backgroundColor: colors.white,
    borderTopWidth: '1@ms',
    borderColor: colors.lightGray5,
  },
  submitButton: {
    width: '80%',
    paddingVertical: '10@vs',
  },
  submitButtonText: {
    ...typography.label.large,
  },
  alertContainer: {
    paddingHorizontal: '10@s',
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: '10@ms',
    marginHorizontal: '10@s',
    alignSelf: 'center',
    backgroundColor: colors.ds.amber[50],
    borderWidth: '0.5@ms',
    borderColor: colors.ds.orange[400],
    borderRadius: '8@s',
    padding: '10@s',
  },
  alertIconContainer: {
    width: '32@s',
    height: '32@s',
    borderColor: colors.carrotOrange,
    borderWidth: '0.5@ms',
    borderRadius: '16@s',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: '10@s',
  },
  alertText: {
    ...typography.body.small,
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    color: colors.ds.red[700],
    flex: 1,
    width: '100%',
  },
});
