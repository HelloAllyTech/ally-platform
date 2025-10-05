import React from 'react';
import {render} from '@testing-library/react-native';

import {DemographicsSection} from '../DemographicsSection';

jest.mock('react-native-size-matters', () => ({
  ScaledSheet: {create: (s: any) => s},
  ms: (n: number) => n,
}));

jest.mock('@/components', () => ({
  CustomDropdown: () => null,
  SearchableLocationDropdown: () => null,
}));

jest.mock('@/hooks', () => ({
  useTranslate: () => ({t: (k: string) => k}),
  useCallSummaryForm: () => ({formData: {}, handleFieldChange: () => () => {}}),
}));

jest.mock('@/store/hooks', () => ({
  useAppSelector: (sel: any) => {
    try {
      return sel({});
    } catch {
      return [];
    }
  },
}));

jest.mock('@/store/slices/summarySlice', () => ({
  selectCallDetails: () => ({startTime: undefined, endTime: undefined}),
  selectSummary: () => ({}),
  selectSummaryVisibleFields: () => [],
}));

jest.mock('@/constants', () => ({
  FIELD_LABELS: {},
  SUMMARY_FIELDS: {
    CALL_ID: 'callId',
    CALL_DURATION: 'callDuration',
    CALL_DATE: 'callDate',
    CALL_TIME: 'callTime',
    CALLER_ID: 'callerId',
    COUNSELOR_NAME: 'counsellorName',
    CALLER_TYPE: 'callerType',
    AGE: 'age',
    GENDER: 'gender',
    PROFESSION: 'profession',
    RELATIONSHIP_STATUS: 'relationshipStatus',
    LANGUAGES: 'languages',
    LOCATION: 'location',
    CONCERN_CODE: 'concernCode',
  },
  summaryFields: [],
  LanguageMap: {},
}));

describe('DemographicsSection', () => {
  it('renders with empty visible fields safely', () => {
    render(<DemographicsSection isEditing={false} />);
  });
});


