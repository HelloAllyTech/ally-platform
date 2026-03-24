import React from 'react';
import {render} from '@testing-library/react-native';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({t: (key: string) => key}),
}));

const mockDispatch = jest.fn();
const mockSelector = jest.fn();
jest.mock('@/store/hooks', () => ({
  useAppDispatch: () => mockDispatch,
  useAppSelector: (selector: unknown) => mockSelector(selector),
}));

jest.mock('@/store/slices/summarySlice', () => ({
  selectSummary: 'selectSummary',
  selectFormData: 'selectFormData',
  selectCallDetails: 'selectCallDetails',
  selectCallInfo: 'selectCallInfo',
  setFormData: jest.fn((data: unknown) => ({type: 'setFormData', payload: data})),
}));

const mockGetFieldValue = jest.fn();
const mockFormatFieldValue = jest.fn();
const mockRenderField = jest.fn();
jest.mock('@/utils/fieldRenderer', () => ({
  getFieldValue: (...args: unknown[]) => mockGetFieldValue(...args),
  formatFieldValue: (...args: unknown[]) => mockFormatFieldValue(...args),
  renderField: (...args: unknown[]) => mockRenderField(...args),
}));

import {GenericSectionContent} from '../GenericSectionContent';

const FIELD_KEY_STUB = 'testField';

function makeSummaryField(overrides: Record<string, unknown> = {}) {
  return {key: FIELD_KEY_STUB, label: 'Test', type: 'text', ...overrides};
}

describe('GenericSectionContent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSelector.mockImplementation((sel: unknown) => {
      if (sel === 'selectSummary') return {test: 'summary'};
      if (sel === 'selectFormData') return {};
      if (sel === 'selectCallDetails') return {};
      if (sel === 'selectCallInfo') return {};
      return undefined;
    });
    mockGetFieldValue.mockReturnValue('raw-value');
    mockFormatFieldValue.mockReturnValue('formatted-value');
    mockRenderField.mockReturnValue(null);
  });

  it('calls renderField for each field', () => {
    const fields = [makeSummaryField({key: 'a'}), makeSummaryField({key: 'b'})];

    render(
      <GenericSectionContent
        fields={fields as any}
        isEditing={false}
        isEnhancing={false}
      />,
    );

    expect(mockRenderField).toHaveBeenCalledTimes(2);
  });

  it('passes correct editing and enhancing flags to renderField', () => {
    const fields = [makeSummaryField()];

    render(
      <GenericSectionContent
        fields={fields as any}
        isEditing={true}
        isEnhancing={true}
      />,
    );

    expect(mockRenderField).toHaveBeenCalledWith(
      fields[0],
      'raw-value',
      'formatted-value',
      true,
      true,
      expect.any(Function),
      expect.objectContaining({
        t: expect.any(Function),
        canEdit: true,
      }),
    );
  });

  it('renders nothing when fields is empty', () => {
    render(
      <GenericSectionContent
        fields={[]}
        isEditing={false}
        isEnhancing={false}
      />,
    );

    expect(mockRenderField).not.toHaveBeenCalled();
  });

  it('dispatches setFormData when handleFieldChange callback is invoked', () => {
    const fields = [makeSummaryField()];
    mockSelector.mockImplementation((sel: unknown) => {
      if (sel === 'selectFormData') return {existing: 'data'};
      return {};
    });

    render(
      <GenericSectionContent
        fields={fields as any}
        isEditing={true}
        isEnhancing={false}
      />,
    );

    const handleFieldChange = mockRenderField.mock.calls[0][5];
    handleFieldChange('new-value');

    expect(mockDispatch).toHaveBeenCalled();
  });
});
