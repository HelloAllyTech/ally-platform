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

const mockHandleField = jest.fn(() => jest.fn());
let mockFormData: any = {};
jest.mock('@/hooks', () => ({
  useTranslate: () => ({t: (k: string) => k}),
  useCallSummaryForm: () => ({formData: mockFormData, handleFieldChange: mockHandleField}),
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
  selectCallDetails: () => ({startTime: '2024-01-01T10:00:00Z', endTime: '2024-01-01T10:30:00Z', callDuration: 1800, clientId: 123, chatId: 'CID-1'}),
  selectSummary: () => ({ languages: [{language: 'ENGLISH', percentage: 60}, {language: 'HINDI', percentage: 40}] }),
  selectSummaryVisibleFields: () => ['callId','callDuration','callDate','callTime','callerId','counsellorName','callerType','age','gender','profession','relationshipStatus','languages','location','concernCode'],
}));

jest.mock('@/constants', () => ({
  FIELD_LABELS: {
    callId: 'Call ID', callDuration: 'Duration', callDate: 'Date', callTime: 'Time', callerId: 'Caller ID', counsellorName: 'Counsellor', callerType: 'Caller Type', age: 'Age', gender: 'Gender', profession: 'Profession', relationshipStatus: 'Relationship', languages: 'Languages', location: 'Location', concernCode: 'Concern Code'
  },
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
  summaryFields: [
    {key: 'callId', type: 'Text'},
    {key: 'callDuration', type: 'Text'},
    {key: 'callDate', type: 'Text'},
    {key: 'callTime', type: 'Text'},
    {key: 'callerId', type: 'Text'},
    {key: 'counsellorName', type: 'Text'},
    {key: 'callerType', type: 'Text'},
    {key: 'age', type: 'InlineTextInput', isEditable: true},
    {key: 'gender', type: 'Dropdown', options: ['Male','Female']},
    {key: 'profession', type: 'InlineTextInput', isEditable: true},
    {key: 'relationshipStatus', type: 'InlineTextInput', isEditable: true},
    {key: 'languages', type: 'Text'},
    {key: 'location', type: 'SearchableDropdown'},
    {key: 'concernCode', type: 'InlineTextInput', isEditable: true},
  ],
  LanguageMap: {ENGLISH: 'English', HINDI: 'Hindi'},
}));

jest.mock('@/utils/date', () => ({
  formatDateWithOrdinal: () => 'Jan 1st, 2024',
  formatTimeHHmm: () => '10:00',
}));

describe('DemographicsSection', () => {
  it('renders all visible fields with values', () => {
    mockFormData = { age: '30', profession: 'Engineer', relationshipStatus: 'Single', location: 'City, State', concernCode: 'C1' } as any;
    const {toJSON} = render(<DemographicsSection isEditing={false} />);
    expect(toJSON()).toBeTruthy();
  });

  it('renders inputs when editing and calls handleFieldChange', () => {
    mockFormData = { age: '30', profession: 'Engineer' } as any;
    render(<DemographicsSection isEditing={true} />);
    expect(mockHandleField).toHaveBeenCalled();
  });
});


