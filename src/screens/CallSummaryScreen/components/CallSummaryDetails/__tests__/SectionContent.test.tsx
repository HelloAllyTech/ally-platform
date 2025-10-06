import React from 'react';
import {render} from '@testing-library/react-native';

import {SectionContent} from '../SectionContent';

jest.mock('@/store/hooks', () => ({
  useAppSelector: (sel: any) => sel({ summary: {}, summaryData: {}, metrics: {} }),
}));

jest.mock('@/hooks', () => ({
  useCallSummaryForm: () => ({ handleFieldChange: () => () => {}, formData: {} }),
}));

jest.mock('../../DemographicsSection/DemographicsSection', () => ({
  DemographicsSection: () => <>demo</>,
}));

jest.mock('../../MetricsSection/MetricsSection', () => ({
  MetricsSection: () => <>metrics</>,
}));

jest.mock('@/constants/summary', () => ({
  FIELD_LABELS: { A: 'A' },
  SUMMARY_FIELDS: { ADDITIONAL_NOTES: 'ADDITIONAL_NOTES' },
  SectionKey: { Metrics: 'Metrics', FeaturesAndDemographics: 'FeaturesAndDemographics' },
  summaryFields: [ { key: 'A', sectionKey: 'X', isEditable: false } ],
}));

describe('CallSummaryScreen/SectionContent', () => {
  it('renders for non-special section', () => {
    const {toJSON} = render(
      <SectionContent section={{ key: 'X' as any, label: 'L', icon: () => null }} canEdit isEditing isEnhancing={false} />,
    );
    expect(toJSON()).toBeTruthy();
  });
});


