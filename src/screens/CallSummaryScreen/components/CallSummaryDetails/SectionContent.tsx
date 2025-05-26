import React from 'react';
import {SvgProps} from 'react-native-svg';

import {
  FIELD_LABELS,
  SectionKey,
  SummaryFieldKey,
  summaryFields,
} from '@/constants/summary';
import {CallSummaryResponse} from '@/services/callSummaryApi';
import {SummaryField} from '@/types/callSummary';
import {FormData} from '@/utils/callSummary/formDataTransformer';

import {DemographicsSection} from '../DemographicsSection/DemographicsSection';
import {EditableField} from '../EditableField/EditableField';
import {MetricsSection} from '../MetricsSection/MetricsSection';

interface SectionContentProps {
  section: {
    key: SectionKey;
    label: string;
    icon: React.FC<SvgProps>;
  };
  summary: CallSummaryResponse['details']['summary'];
  formData: FormData;
  onFieldChange: (field: SummaryFieldKey) => (value: string) => void;
}

export const SectionContent: React.FC<SectionContentProps> = ({
  section,
  summary,
  formData,
  onFieldChange,
}) => {
  const sectionFields = summaryFields.filter(
    field => field.sectionKey === section.key,
  );
  const renderSummaryField = (field: SummaryField) => {
    return (
      <EditableField
        fieldKey={field.key}
        label={FIELD_LABELS[field.key]}
        value={formData[field.key] ?? null}
        onChangeText={onFieldChange(field.key)}
      />
    );
  };

  // TO DO: Remove this component and use the renderSummaryField function instead
  if (section.key === SectionKey.Metrics)
    return (
      <MetricsSection
        metrics={{
          listeningShare: summary?.metrics?.listeningRatio ?? null,
          reflectiveQuestionsAsked:
            summary?.metrics?.reflectiveQuestionsAsked ?? null,
          emotionsLift: summary?.metrics?.emotionsLift ?? null,
        }}
      />
    );

  // TO DO: Remove this component and use the renderSummaryField function instead
  if (section.key === SectionKey.FeaturesAndDemographics)
    return (
      <DemographicsSection
        demographics={{
          callId: summary?.callId,
          callDuration: summary?.callDuration,
          callDate: summary?.dateOfSession,
          callTime: summary?.callTime,
          callerId: summary?.clientId,
          callerType: summary?.callType,
          age: summary?.age,
          gender: summary?.gender,
          profession: summary?.profession,
          location: summary?.location,
          languages: summary?.languages,
          concernCode: summary?.codeOfConcern,
          moodImprovedBy: summary?.moodImprovedBy,
          counsellorName: summary?.counselorName,
        }}
      />
    );

  return sectionFields.map(renderSummaryField);
};
