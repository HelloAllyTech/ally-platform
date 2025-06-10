import React from 'react';
import {SvgProps} from 'react-native-svg';

import {FIELD_LABELS, SectionKey, summaryFields} from '@/constants/summary';
import {useCallSummaryForm} from '@/hooks/useCallSummaryForm';
import {useAppSelector} from '@/store/hooks';
import {selectMetrics, selectSummary} from '@/store/slices/summarySlice';
import {EditableFieldKey, SummaryField} from '@/types/callSummary';

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
  const summary = useAppSelector(selectSummary);
  const metrics = useAppSelector(selectMetrics);

  const sectionFields = summaryFields.filter(
    field => field.sectionKey === section.key,
  );
  const {handleFieldChange, formData} = useCallSummaryForm();

  const renderSummaryField = (field: SummaryField) => {
    // For editable fields, use formData; for non-editable fields, use summary
    const getValue = () => {
      if (field.isEditable && formData?.[field.key as EditableFieldKey]) {
        return formData[field.key as EditableFieldKey] || null;
      }
      return summary?.[field.key] as string | null;
    };

    return (
      <EditableField
        key={field.key}
        fieldKey={field.key}
        label={FIELD_LABELS[field.key]}
        value={getValue()}
        onChangeText={handleFieldChange(field.key)}
        canEdit={canEdit}
        isEditing={isEditing}
        isEnhancing={isEnhancing}
        placeholder={'-'}
      />
    );
  };

  if (section.key === SectionKey.Metrics) {
    return <MetricsSection metrics={metrics} />;
  }

  // TO DO: Remove this component and use the renderSummaryField function instead
  if (section.key === SectionKey.FeaturesAndDemographics) {
    return <DemographicsSection isEditing={isEditing} />;
  }

  return <>{sectionFields.map(renderSummaryField)}</>;
};

export default SectionContent;
