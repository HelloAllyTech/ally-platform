import React from 'react';
import {render} from '@testing-library/react-native';

jest.mock('@/hooks/useTranslate', () => ({
  useTranslate: () => ({t: (k: string) => k}),
}));

jest.mock('@/components', () => ({
  CustomDropdown: () => null,
}));

jest.mock('@/services/customFieldsApi', () => ({
  CustomFieldEditPermission: {
    ADMIN_ONLY: 'ADMIN_ONLY',
    COUNSELLOR_ONLY: 'COUNSELLOR_ONLY',
    BOTH: 'BOTH',
  },
  CustomFieldType: {
    TEXT: 'TEXT',
    NUMBER: 'NUMBER',
    SINGLE_SELECT: 'SINGLE_SELECT',
    MULTI_SELECT: 'MULTI_SELECT',
    DATE: 'DATE',
    BOOLEAN: 'BOOLEAN',
  },
}));

import {CustomFieldsSection} from '../CustomFieldsSection';

const def = (over: any) => ({
  id: over.id,
  name: over.name,
  fieldType: over.fieldType,
  sectionKey: 'metrics',
  editPermission: 'BOTH' as any,
  options: over.options ?? [],
  showInTable: false,
});

describe('CallSummaryScreen/CustomFieldsSection', () => {
  const baseProps = {
    onValueChange: jest.fn(),
    isEditing: false,
    sectionKey: 'metrics',
    isAdmin: true,
    isCounsellorForCall: true,
  };

  // Regression: non-dropdown fields (TEXT/NUMBER/DATE) must show their name in
  // view mode. Previously they rendered via a label-less component, so empty
  // ones collapsed to a bare "-" and looked missing.
  it('renders the field name for non-dropdown types even when empty', () => {
    const {getByText} = render(
      <CustomFieldsSection
        {...baseProps}
        definitions={[
          def({id: '1', name: 'Session Count', fieldType: 'NUMBER'}),
          def({id: '2', name: 'Follow Up Notes', fieldType: 'TEXT'}),
          def({id: '3', name: 'Next Appointment', fieldType: 'DATE'}),
        ]}
        localValues={{}}
      />,
    );

    expect(getByText('Session Count:')).toBeTruthy();
    expect(getByText('Follow Up Notes:')).toBeTruthy();
    expect(getByText('Next Appointment:')).toBeTruthy();
  });

  it('renders the saved value alongside the name for non-dropdown types', () => {
    const {getByText} = render(
      <CustomFieldsSection
        {...baseProps}
        definitions={[def({id: '1', name: 'Session Count', fieldType: 'NUMBER'})]}
        localValues={{'1': '7'}}
      />,
    );

    expect(getByText('Session Count:')).toBeTruthy();
    expect(getByText('7')).toBeTruthy();
  });

  it('keeps the name visible and exposes the input in edit mode', () => {
    const {getByText, getByDisplayValue} = render(
      <CustomFieldsSection
        {...baseProps}
        isEditing
        definitions={[def({id: '1', name: 'Session Count', fieldType: 'NUMBER'})]}
        localValues={{'1': '7'}}
      />,
    );

    // Label stays even while editing, and the wired input is present.
    expect(getByText('Session Count:')).toBeTruthy();
    expect(getByDisplayValue('7')).toBeTruthy();
  });
});
