import React from 'react';
import {SvgProps} from 'react-native-svg';

import {FIELD_LABELS, SectionKey, summaryFields} from '@/constants/summary';
import {useCallSummaryForm} from '@/hooks/useCallSummaryForm';
import {useAppSelector} from '@/store/hooks';
import {AppRootState} from '@/store/store';
import {SummaryField} from '@/types/callSummary';

import {DemographicsSection} from '../DemographicsSection/DemographicsSection';
import {EditableField} from '../EditableField/EditableField';
import {MetricsSection} from '../MetricsSection/MetricsSection';

interface SectionContentProps {
  section: {
    key: SectionKey;
    label: string;
    icon: React.FC<SvgProps>;
  };
  canEdit: boolean;
  isEditing: boolean;
  isEnhancing: boolean;
}

export const SectionContent: React.FC<SectionContentProps> = ({
  section,
  canEdit,
  isEditing,
  isEnhancing,
}) => {
  const summaryData = useAppSelector(
    (state: AppRootState) => state.summary.summaryData,
  );
  const summary = summaryData?.details?.summary;
  const sectionFields = summaryFields.filter(
    field => field.sectionKey === section.key,
  );
  const {handleFieldChange, formData} = useCallSummaryForm();

  const renderSummaryField = (field: SummaryField) => {
    return (
      <EditableField
        key={field.key}
        fieldKey={field.key}
        label={FIELD_LABELS[field.key]}
        value={formData?.[field.key] as string | null}
        onChangeText={handleFieldChange(field.key)}
        canEdit={canEdit}
        isEditing={isEditing}
        isEnhancing={isEnhancing}
        placeholder={'-'}
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
  if (section.key === SectionKey.FeaturesAndDemographics) {
    return <DemographicsSection isEditing={isEditing} />;
  }

  return sectionFields.map(renderSummaryField);
};
