import React, {memo, useCallback, useState} from 'react';
import {ActivityIndicator, Text, View} from 'react-native';
import {KeyboardAwareScrollView} from 'react-native-keyboard-aware-scroll-view';
import {ScaledSheet} from 'react-native-size-matters';

import {GoldenShieldIcon} from '@/assets';
import {PrimaryButton} from '@/components';
import {
  ALWAYS_VISIBLE_SECTIONS,
  SECTION_LIST,
  SectionKey,
  summaryFields,
} from '@/constants';
import {useCallSummaryForm, useTranslate} from '@/hooks';
import {useAppSelector} from '@/store/hooks';
import {selectSummaryVisibleFields} from '@/store/slices/summarySlice';
import {colors, typography} from '@/theme';
import {SectionItem} from '@/types';

import {SectionWrapper} from '../SectionWrapper/SectionWrapper';

interface Props {
  isLoading: boolean;
  onSubmit: (isUpdateSuccess: boolean) => void;
  showSaveButton: boolean;
}

const CallSummaryDetailsComponent: React.FC<Props> = ({
  isLoading: isLoadingSummary,
  onSubmit,
  showSaveButton,
}) => {
  const {t} = useTranslate();
  const visibleFields = useAppSelector(selectSummaryVisibleFields);
  const {isUpdating, handleSubmit} = useCallSummaryForm();

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
            label={sectionConfig.label}
            isExpanded={expanded[sectionConfig.key]}
            onToggle={() => toggleSection(sectionConfig.key)}
            icon={<Icon />}
            sectionConfig={sectionConfig}
            index={index}
            handleSubmit={handleSubmit}
            isEditing={isEditing[sectionConfig.key]}
            setIsEditing={setIsEditing}
          />
        </View>
      );
    },
    [expanded, isEditing, handleSubmit, toggleSection, visibleFields],
  );

  if (isLoadingSummary) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color={colors.darkSlate} />
      </View>
    );
  }

  return (
    <KeyboardAwareScrollView
      style={styles.container}
      nestedScrollEnabled
      extraScrollHeight={150}
      keyboardShouldPersistTaps="handled"
      enableOnAndroid>
      <View style={styles.alertContainer}>
        <View style={styles.alertIconContainer}>
          <GoldenShieldIcon />
        </View>
        <Text style={styles.alertText}>
          {t('CallSummary.aiGeneratedWarning')}
        </Text>
      </View>
      <View style={styles.card}>{SECTION_LIST.map(renderSection)}</View>
      {showSaveButton && (
        <View style={styles.buttonContainer}>
          <PrimaryButton
            label={t('save')}
            onPress={onSubmitButtonPress}
            isLoading={isUpdating}
            customContainerStyle={styles.submitButton}
            customTextStyle={styles.submitButtonText}
          />
        </View>
      )}
    </KeyboardAwareScrollView>
  );
};

export const CallSummaryDetails = memo(CallSummaryDetailsComponent);

const styles = ScaledSheet.create({
  container: {
    flex: 1,
    paddingBottom: '40@ms',
    paddingTop: '85@ms',
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
    alignItems: 'center',
    paddingTop: '20@ms',
    borderTopWidth: '1@ms',
    borderColor: colors.lightGray5,
  },
  submitButton: {
    width: '30%',
    paddingVertical: '10@vs',
  },
  submitButtonText: {
    ...typography.label.large,
  },
  alertContainer: {
    paddingHorizontal: '10@s',
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: '20@ms',
    marginHorizontal: '10@s',
    alignSelf: 'center',
    backgroundColor: colors.floralWhite,
    borderRadius: '8@s',
    padding: '10@s',
  },
  alertIconContainer: {
    width: '32@s',
    height: '32@s',
    borderColor: colors.carrotOrange,
    borderWidth: '1@s',
    borderRadius: '16@s',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: '10@s',
  },
  alertText: {
    ...typography.body.medium,
    color: colors.russetBrown,
    flex: 1,
    width: '100%',
  },
});
