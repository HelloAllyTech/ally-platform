// CallSummaryDetails.tsx

import React, {useState} from 'react';
import {ActivityIndicator, View} from 'react-native';
import {KeyboardAwareScrollView} from 'react-native-keyboard-aware-scroll-view';
import {ScaledSheet} from 'react-native-size-matters';

import {PrimaryButton} from '@/components';
import {SECTION_LIST, SectionKey} from '@/constants/summary';
// import {useAppNavigation} from '@/hooks/useAppNavigation';
import {useCallSummaryForm} from '@/hooks/useCallSummaryForm';
import useTranslate from '@/hooks/useTranslate';
import {CallSummaryResponse} from '@/services/callSummaryApi';
import {useGetSummaryFieldsQuery} from '@/services/settingsApi';
import {colors} from '@/theme/colors';
import {typography} from '@/theme/typography';

import CallSummarySection from '../CallSummarySections/CallSummarySection';

interface Props {
  summaryData: CallSummaryResponse;
  isLoading: boolean;
  onSubmit: (isUpdateSuccess: boolean) => void;
}

export const CallSummaryDetails: React.FC<Props> = ({
  summaryData,
  isLoading: isLoadingSummary,
  onSubmit,
}) => {
  // const navigation = useAppNavigation();
  const {data: visibleFields, isLoading: isLoadingFields} =
    useGetSummaryFieldsQuery();
  const {t} = useTranslate();
  const summaryDetails = summaryData?.details;

  const {formData, isUpdating, handleFieldChange, handleSubmit} =
    useCallSummaryForm({
      summaryData,
    });

  const [expanded, setExpanded] = useState({
    [SectionKey.SessionSummary]: false,
    [SectionKey.KeyConcern]: false,
    [SectionKey.FeaturesAndDemographics]: false,
    [SectionKey.Flow]: false,
    [SectionKey.ObjectiveObservations]: false,
    [SectionKey.SubjectiveObservations]: false,
    [SectionKey.Assessment]: false,
    [SectionKey.DominantFeelings]: false,
    [SectionKey.IssuesWorkedOn]: false,
    [SectionKey.KeyTherapeuticTechniques]: false,
    [SectionKey.ReferralsProvided]: false,
    [SectionKey.HomeworkRecommended]: false,
    [SectionKey.PlansForNextCall]: false,
    [SectionKey.Tags]: false,
    [SectionKey.Metrics]: false,
  });

  const onSubmitButtonPress = async () => {
    const response = await handleSubmit();
    onSubmit(Boolean(response?.data));
  };

  const toggleSection = (key: SectionKey) => {
    setExpanded(prev => ({...prev, [key]: !prev[key]}));
  };

  if (isLoadingSummary || isLoadingFields) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color={colors.darkSlate} />
      </View>
    );
  }

  return (
    <KeyboardAwareScrollView style={styles.container}>
      <View style={styles.card}>
        {SECTION_LIST.map((section, index) => {
          // TO DO: Commenting this out for now to view all sections
          // const hasVisibleFields = visibleFields?.some(
          //   field =>
          //     summaryFields.find(summaryField => summaryField.key === field)
          //       ?.sectionKey === section.key,
          // );

          // if (!hasVisibleFields) {
          //   return null;
          // }

          const Icon = section.icon;

          return (
            <View key={section.key} style={styles.sectionBox}>
              <CallSummarySection
                label={section.label}
                isExpanded={expanded[section.key]}
                onToggle={() => toggleSection(section.key)}
                icon={<Icon />}
                canEdit={section.canEdit}
                formData={formData}
                sectionData={section}
                expanded={expanded}
                summaryDetails={summaryDetails}
                onFieldChange={handleFieldChange}
                index={index}
              />
            </View>
          );
        })}
      </View>
      <View style={styles.buttonContainer}>
        <PrimaryButton
          label={t('submit')}
          onPress={onSubmitButtonPress}
          isLoading={isUpdating}
          customContainerStyle={styles.submitButton}
          customTextStyle={styles.submitButtonText}
        />
      </View>
    </KeyboardAwareScrollView>
  );
};

const styles = ScaledSheet.create({
  container: {
    flex: 1,
    paddingTop: '10@ms',
    paddingBottom: '40@ms',
  },
  card: {
    paddingHorizontal: '16@s',
    backgroundColor: colors.white,
    marginBottom: '20@ms',
  },
  sectionBox: {
    overflow: 'hidden',
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
