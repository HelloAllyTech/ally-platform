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
  summaryDetails: CallSummaryResponse['details'];
  formData: FormData;
  onFieldChange: (field: SummaryFieldKey) => (value: string) => void;
}

export const SectionContent: React.FC<SectionContentProps> = ({
  section,
  summaryDetails,
  formData,
  onFieldChange,
}) => {
  const summary = summaryDetails?.summary;
  const sectionFields = summaryFields.filter(
    field => field.sectionKey === section.key,
  );
  const renderSummaryField = (field: SummaryField) => {
    return (
      <EditableField
        key={field.key}
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
          listeningShare: summary?.listeningShare ?? null,
          reflectiveQuestionsAsked: summary?.reflectiveQuestionsAsked ?? null,
          emotionalLift: summary?.emotionalLift ?? null,
        }}
      />
    );

  // TO DO: Remove this component and use the renderSummaryField function instead
  if (section.key === SectionKey.FeaturesAndDemographics)
    return <DemographicsSection summaryDetails={summaryDetails} />;

  return sectionFields.map(renderSummaryField);
};
