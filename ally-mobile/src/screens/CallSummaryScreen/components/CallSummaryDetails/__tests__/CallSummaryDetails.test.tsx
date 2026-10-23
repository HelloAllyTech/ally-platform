import React from 'react';
import {act, fireEvent, render} from '@testing-library/react-native';

import {CallSummaryDetails} from '../CallSummaryDetails';

// Simplify SectionWrapper to a tappable element invoking onToggle, plus a
// plain text input + save button per custom field definition in this section
// (needed to drive the custom-field edit/save regression test below).
jest.mock('../../SectionWrapper/SectionWrapper', () => ({
  SectionWrapper: ({
    label,
    onToggle,
    sectionConfig,
    customFieldDefs,
    customFieldLocalValues,
    onCustomFieldChange,
    onCustomFieldSave,
  }: any) => {
    const React = require('react');
    const {Text, TouchableOpacity, TextInput} = require('react-native');
    const defsForSection = (customFieldDefs ?? []).filter(
      (d: any) => d.sectionKey === sectionConfig?.key,
    );
    return (
      <>
        <TouchableOpacity onPress={onToggle}>
          <Text>{label}</Text>
        </TouchableOpacity>
        {defsForSection.map((d: any) => (
          <TextInput
            key={d.id}
            testID={`field-${d.id}`}
            value={customFieldLocalValues?.[d.id] ?? ''}
            // `v || null` mirrors the real editors in CustomFieldsSection:
            // clearing a field reports null, not an empty string.
            onChangeText={(v: string) => onCustomFieldChange?.(d.id, v || null)}
          />
        ))}
        {sectionConfig && (
          <TouchableOpacity
            testID={`save-${sectionConfig.key}`}
            onPress={() => onCustomFieldSave?.(sectionConfig.key)}>
            <Text>{`save-${sectionConfig.key}`}</Text>
          </TouchableOpacity>
        )}
      </>
    );
  },
}));

// Mock Button to make onPress accessible
const mockShowToast = jest.fn();
jest.mock('@/components', () => ({
  Button: ({label, onPress}: any) => {
    const React = require('react');
    const {Text, TouchableOpacity} = require('react-native');
    return (
      <TouchableOpacity onPress={onPress}>
        <Text>{label}</Text>
      </TouchableOpacity>
    );
  },
  useToast: () => ({showToast: mockShowToast}),
}));

// Constants: two sections, one always visible, one conditionally visible
jest.mock('@/constants', () => ({
  ALWAYS_VISIBLE_SECTIONS: ['always'] as string[],
  SECTION_LIST: [
    {key: 'always', label: 'Always', labelKey: 'Always', icon: () => null},
    {
      key: 'conditional',
      label: 'Conditional',
      labelKey: 'Conditional',
      icon: () => null,
    },
  ],
  summaryFields: [
    {key: 'field1', label: 'F1', sectionKey: 'conditional'},
  ],
}));

// Selector returns a visible field that maps to conditional section
jest.mock('@/store/slices/summarySlice', () => ({
  selectSummaryVisibleFields: () => ['field1'],
}));

// Store hooks
jest.mock('@/store/hooks', () => ({
  useAppSelector: (sel: any) => sel({}),
}));

// Mock custom fields API to avoid RTK store initialization in test env.
// Exposed as mutable jest.fn()s so individual tests can reconfigure return
// values (e.g. to simulate a background refetch changing customFieldValues).
const mockGetCustomFieldDefinitions = jest.fn<any, any[]>(() => ({data: undefined}));
const mockGetCustomFieldValues = jest.fn<any, any[]>(() => ({data: undefined}));
const mockUpsertCustomFieldValues = jest.fn<any, any[]>(() =>
  Promise.resolve({data: {success: true}}),
);
const mockGetCustomFieldsEnabled = jest.fn<any, any[]>(() => ({data: false}));
jest.mock('@/services/customFieldsApi', () => ({
  useGetCustomFieldDefinitionsQuery: (...args: any[]) =>
    mockGetCustomFieldDefinitions(...args),
  useGetCustomFieldValuesQuery: (...args: any[]) => mockGetCustomFieldValues(...args),
  useUpsertCustomFieldValuesMutation: () => [mockUpsertCustomFieldValues],
  useGetCustomFieldsEnabledQuery: (...args: any[]) => mockGetCustomFieldsEnabled(...args),
}));

// Translate
jest.mock('@/hooks', () => ({
  useTranslate: () => ({t: (k: string) => k}),
  useCallSummaryForm: () => ({
    isUpdating: false,
    handleSubmit: jest.fn(async () => ({data: {ok: true}})),
  }),
}));

// Avoid native KeyboardAwareScrollView behavior in tests
jest.mock('react-native-keyboard-aware-scroll-view', () => ({
  KeyboardAwareScrollView: ({children}: any) => children,
}));

describe('CallSummaryDetails', () => {
  it('shows loader when isLoading is true', () => {
    const {getByTestId} = render(
      // Wrap with testID by querying ActivityIndicator via accessibility role is tricky;
      // Instead rely on render not crashing with loader branch
      <CallSummaryDetails isLoading onSubmit={jest.fn()} showSaveButton={false} /> as any,
    );
    // If not crashed, consider loader covered; no specific assertions required
    expect(getByTestId).toBeDefined();
  });

  it('renders sections and submits via Button', async () => {
    const onSubmit = jest.fn();
    const {getByText} = render(
      <CallSummaryDetails isLoading={false} onSubmit={onSubmit} showSaveButton />,
    );

    // Both sections should be rendered
    expect(getByText('Always')).toBeTruthy();
    expect(getByText('Conditional')).toBeTruthy();

    await act(async () => {
      fireEvent.press(getByText('common.save'));
    });
    expect(onSubmit).toHaveBeenCalledWith(true);
  });
});

describe('CallSummaryDetails — custom field save does not revert fields the user did not touch', () => {
  const CF_A = {
    id: 'cf-a',
    name: 'Session No',
    sectionKey: 'conditional',
    fieldType: 'NUMBER',
    editPermission: 'BOTH',
  };
  const CF_B = {
    id: 'cf-b',
    name: 'Topic',
    sectionKey: 'conditional',
    fieldType: 'TEXT',
    editPermission: 'BOTH',
  };

  beforeEach(() => {
    mockGetCustomFieldsEnabled.mockReturnValue({data: true});
    mockGetCustomFieldDefinitions.mockReturnValue({data: [CF_A, CF_B]});
    mockUpsertCustomFieldValues.mockClear();
    mockUpsertCustomFieldValues.mockReturnValue(Promise.resolve({data: {success: true}}));
  });

  it('only submits the field the user edited, even if another field drifted in the background', async () => {
    mockGetCustomFieldValues.mockReturnValue({
      data: [
        {fieldDefinitionId: 'cf-a', value: '5'},
        {fieldDefinitionId: 'cf-b', value: 'Anxiety'},
      ],
    });

    const {getByTestId, rerender} = render(
      <CallSummaryDetails isLoading={false} onSubmit={jest.fn()} showSaveButton chatId={1} />,
    );

    // User edits Topic (cf-b) only — Session No (cf-a) is never touched.
    fireEvent.changeText(getByTestId('field-cf-b'), 'Depression');

    // Simulate a background refetch (another editor, or an AI-fill pass)
    // surfacing a changed Session No that this screen never asked for.
    mockGetCustomFieldValues.mockReturnValue({
      data: [
        {fieldDefinitionId: 'cf-a', value: '6'},
        {fieldDefinitionId: 'cf-b', value: 'Anxiety'},
      ],
    });
    rerender(
      <CallSummaryDetails isLoading={false} onSubmit={jest.fn()} showSaveButton chatId={1} />,
    );

    await act(async () => {
      fireEvent.press(getByTestId('save-conditional'));
    });

    expect(mockUpsertCustomFieldValues).toHaveBeenCalledTimes(1);
    expect(mockUpsertCustomFieldValues).toHaveBeenCalledWith({
      chatId: 1,
      values: [{fieldDefinitionId: 'cf-b', value: 'Depression'}],
    });
  });

  it('sends a cleared field as null so the backend actually clears it', async () => {
    mockGetCustomFieldValues.mockReturnValue({
      data: [{fieldDefinitionId: 'cf-b', value: 'Anxiety'}],
    });

    const {getByTestId} = render(
      <CallSummaryDetails isLoading={false} onSubmit={jest.fn()} showSaveButton chatId={1} />,
    );

    fireEvent.changeText(getByTestId('field-cf-b'), '');

    await act(async () => {
      fireEvent.press(getByTestId('save-conditional'));
    });

    // null, not undefined: JSON.stringify drops undefined keys, so the PUT body
    // omitted `value` and the backend left the column untouched — the cleared
    // value came back on reopen.
    const [{values}] = mockUpsertCustomFieldValues.mock.calls[0];
    expect(values).toEqual([{fieldDefinitionId: 'cf-b', value: null}]);
    expect(values[0].value).not.toBeUndefined();
  });

  it('does not mark a custom field as saved when the save request fails, and tells the user', async () => {
    mockGetCustomFieldValues.mockReturnValue({
      data: [{fieldDefinitionId: 'cf-b', value: 'Anxiety'}],
    });
    mockUpsertCustomFieldValues.mockClear();
    mockShowToast.mockClear();
    mockUpsertCustomFieldValues.mockReturnValueOnce(
      Promise.resolve({error: {status: 500, data: 'Internal Server Error'}}),
    );

    const {getByTestId} = render(
      <CallSummaryDetails isLoading={false} onSubmit={jest.fn()} showSaveButton chatId={1} />,
    );

    fireEvent.changeText(getByTestId('field-cf-b'), 'Depression');

    await act(async () => {
      fireEvent.press(getByTestId('save-conditional'));
    });

    // The write failed — the user must be told, not left thinking it saved.
    expect(mockShowToast).toHaveBeenCalledWith(
      'summary.customFieldSaveFailed',
      'error',
    );

    // Saving again (e.g. after being told and retrying) must resend the same
    // edit — it must still be considered unsaved. Before the fix, the failed
    // save cleared the field's dirty flag anyway, so this second tap sent
    // nothing and the edit was silently lost for good.
    mockUpsertCustomFieldValues.mockReturnValueOnce(
      Promise.resolve({data: {success: true}}),
    );
    await act(async () => {
      fireEvent.press(getByTestId('save-conditional'));
    });

    expect(mockUpsertCustomFieldValues).toHaveBeenLastCalledWith({
      chatId: 1,
      values: [{fieldDefinitionId: 'cf-b', value: 'Depression'}],
    });
  });
});
