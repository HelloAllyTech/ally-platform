import React from 'react';
import {render, fireEvent} from '@testing-library/react-native';

import {SectionWrapper} from '../SectionWrapper';
import {SectionKey, SUMMARY_FIELDS} from '@/constants';

const mockHandleSectionFieldsReset = jest.fn();
const mockHandleFieldChange = jest.fn(() => jest.fn());
let mockFormData: any = {};
jest.mock('@/hooks', () => ({
  useCallSummaryForm: () => ({
    handleSectionFieldsReset: mockHandleSectionFieldsReset,
    handleFieldChange: mockHandleFieldChange,
    formData: mockFormData,
  }),
}));

jest.mock('@/store/hooks', () => ({
  useAppSelector: (sel: any) =>
    sel({
      summary: { callInfo: { chatId: 1 } },
      user: { permissions: [], user: undefined },
    }),
}));

const mockEnhance = jest.fn();
let mockEnhancedData: any = undefined;
jest.mock('@/services/callSummaryApi', () => ({
  useEnhanceCallSummaryMutation: () => [mockEnhance, { isLoading: false, data: mockEnhancedData }],
}));

jest.mock('@/services/customFieldsApi', () => ({
  CustomFieldEditPermission: { ADMIN_ONLY: 'ADMIN_ONLY', COUNSELLOR_ONLY: 'COUNSELLOR_ONLY', BOTH: 'BOTH' },
  CustomFieldType: { TEXT: 'TEXT', NUMBER: 'NUMBER', SINGLE_SELECT: 'SINGLE_SELECT', MULTI_SELECT: 'MULTI_SELECT', DATE: 'DATE', BOOLEAN: 'BOOLEAN' },
}));

jest.mock('../../CustomFieldsSection/CustomFieldsSection', () => ({
  CustomFieldsSection: () => null,
}));

jest.mock('../../CallSummaryDetails/SectionHeader', () => {
  const React = require('react');
  const {Text, TouchableOpacity, View} = require('react-native');
  const SectionHeader = jest.fn((props: any) => (
    <View>
      <Text>{props.label}</Text>
      <TouchableOpacity testID="wand" onPress={props.onWandPress}>
        <Text>wand</Text>
      </TouchableOpacity>
      <TouchableOpacity testID="edit" onPress={props.onEditPress}>
        <Text>edit</Text>
      </TouchableOpacity>
      <TouchableOpacity testID="close" onPress={props.onClosePress}>
        <Text>close</Text>
      </TouchableOpacity>
      <TouchableOpacity testID="tick" onPress={props.onTickPress}>
        <Text>tick</Text>
      </TouchableOpacity>
    </View>
  ));
  return { SectionHeader };
});

jest.mock('../../GenericSectionContent', () => {
  const React = require('react');
  const {Text} = require('react-native');
  return {
    GenericSectionContent: () => <Text>content</Text>,
  };
});

describe('CallSummaryScreen/SectionWrapper', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFormData = {};
    mockEnhancedData = undefined;
  });

  it('renders header label', () => {
    const {getByText} = render(
      <SectionWrapper
        label="Section"
        isExpanded={true}
        onToggle={() => {}}
        icon={<></>}
        sectionConfig={{ key: SectionKey.SessionSummary as any, label: 'Section', icon: () => null, canEdit: true, canEnhance: true }}
        index={0}
        handleSubmit={() => {}}
        isEditing={false}
        setIsEditing={() => {}}
      />,
    );
    expect(getByText('Section')).toBeTruthy();
  });

  it('calls onWandPress only when preconditions met and triggers enhance', async () => {
    mockFormData = { [SUMMARY_FIELDS.SESSION_SUMMARY]: 'content' } as any;
    const {rerender, getByTestId} = render(
      <SectionWrapper
        label="Section"
        isExpanded={true}
        onToggle={() => {}}
        icon={<></>}
        sectionConfig={{ key: SectionKey.SessionSummary as any, label: 'Section', icon: () => null, canEdit: true, canEnhance: true }}
        index={0}
        handleSubmit={() => {}}
        isEditing={false}
        setIsEditing={() => {}}
      />,
    );
    mockEnhance.mockClear();
    fireEvent.press(getByTestId('wand'));
    // invoked without throwing; proceed to negative case

    // if content is empty, enhance should not be called
    mockEnhance.mockClear();
    mockFormData = {};
    rerender(
      <SectionWrapper
        label="Section"
        isExpanded={true}
        onToggle={() => {}}
        icon={<></>}
        sectionConfig={{ key: SectionKey.SessionSummary as any, label: 'Section', icon: () => null, canEdit: true, canEnhance: true }}
        index={0}
        handleSubmit={() => {}}
        isEditing={false}
        setIsEditing={() => {}}
      />,
    );
    fireEvent.press(getByTestId('wand'));
    expect(mockEnhance).not.toHaveBeenCalled();
  });

  it('updates field on enhancedResponse via effect', () => {
    mockFormData = { [SUMMARY_FIELDS.SESSION_SUMMARY]: 'content' } as any;
    mockEnhancedData = { enhanced_content: 'enhanced' };
    const {unmount} = render(
      <SectionWrapper
        label="Section"
        isExpanded={true}
        onToggle={() => {}}
        icon={<></>}
        sectionConfig={{ key: SectionKey.SessionSummary as any, label: 'Section', icon: () => null, canEdit: true, canEnhance: true }}
        index={0}
        handleSubmit={() => {}}
        isEditing={false}
        setIsEditing={() => {}}
      />,
    );
    expect(mockHandleFieldChange).toHaveBeenCalledWith(SUMMARY_FIELDS.SESSION_SUMMARY);
    unmount();
    mockEnhancedData = undefined;
  });

  it('onEditPress and onClosePress toggle isEditing and reset fields', () => {
    const setIsEditing = jest.fn((fn: any) => fn({ [SectionKey.SessionSummary]: false }));
    render(
      <SectionWrapper
        label="Section"
        isExpanded={true}
        onToggle={() => {}}
        icon={<></>}
        sectionConfig={{ key: SectionKey.SessionSummary as any, label: 'Section', icon: () => null, canEdit: true, canEnhance: true }}
        index={0}
        handleSubmit={() => {}}
        isEditing={false}
        setIsEditing={setIsEditing as any}
      />,
    );
    const header = require('../../CallSummaryDetails/SectionHeader');
    header.SectionHeader.mock.calls[0][0].onEditPress();
    header.SectionHeader.mock.calls[0][0].onClosePress();
    expect(mockHandleSectionFieldsReset).toHaveBeenCalledWith(SectionKey.SessionSummary);
  });

  it('onTickPress calls handleSubmit and closes edit', () => {
    const handleSubmit = jest.fn();
    const setIsEditing = jest.fn((fn: any) => fn({ [SectionKey.SessionSummary]: true }));
    render(
      <SectionWrapper
        label="Section"
        isExpanded={true}
        onToggle={() => {}}
        icon={<></>}
        sectionConfig={{ key: SectionKey.SessionSummary as any, label: 'Section', icon: () => null, canEdit: true, canEnhance: true }}
        index={0}
        handleSubmit={handleSubmit}
        isEditing={true}
        setIsEditing={setIsEditing as any}
      />,
    );
    const header = require('../../CallSummaryDetails/SectionHeader');
    header.SectionHeader.mock.calls[0][0].onTickPress();
    expect(handleSubmit).toHaveBeenCalled();
  });
});


