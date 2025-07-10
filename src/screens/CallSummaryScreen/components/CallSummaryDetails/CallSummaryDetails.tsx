import React, {memo, useCallback, useState} from 'react';
import {ActivityIndicator, View} from 'react-native';
import {KeyboardAwareScrollView} from 'react-native-keyboard-aware-scroll-view';
import {ScaledSheet} from 'react-native-size-matters';

import {PrimaryButton} from '@/components';
import {SECTION_LIST, SectionKey, summaryFields} from '@/constants/summary';
import {useCallSummaryForm} from '@/hooks/useCallSummaryForm';
import useTranslate from '@/hooks/useTranslate';
import {useAppSelector} from '@/store/hooks';
import {selectSummaryVisibleFields} from '@/store/slices/summarySlice';
import {colors} from '@/theme/colors';
import {typography} from '@/theme/typography';
import {SectionItem} from '@/types/callSummary';

import {SectionWrapper} from '../SectionWrapper/SectionWrapper';

interface Props {
  isLoading: boolean;
  onSubmit: (isUpdateSuccess: boolean) => void;
  showSubmitButton: boolean;
}

const CallSummaryDetailsComponent: React.FC<Props> = ({
  isLoading: isLoadingSummary,
  onSubmit,
  showSubmitButton,
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
      const hasVisibleFields = visibleFields?.some(
        field =>
          summaryFields.find(summaryField => summaryField.key === field)
            ?.sectionKey === sectionConfig.key,
      );

      if (!hasVisibleFields) {
        return null;
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
      <View style={styles.card}>{SECTION_LIST.map(renderSection)}</View>
      {showSubmitButton && (
        <View style={styles.buttonContainer}>
          <PrimaryButton
            label={t('submit')}
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
  },
  card: {
    paddingHorizontal: '16@s',
    backgroundColor: colors.white,
    marginBottom: '20@ms',
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
});
