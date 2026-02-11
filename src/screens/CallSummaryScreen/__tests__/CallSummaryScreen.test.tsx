import React from 'react';
import {render, fireEvent} from '@testing-library/react-native';

// Mock components barrel items used by screen
jest.mock('@/components', () => {
  const React = require('react');
  const {Text} = require('react-native');
  return {
    PrimaryButton: ({onPress, label}: any) => React.createElement(Text, {onPress}, label),
    useToast: () => ({ showToast: jest.fn() }),
  };
});

// Mock per-screen subcomponents to simple text markers
jest.mock('@/screens/CallSummaryScreen/components', () => {
  const React = require('react');
  const {Text} = require('react-native');
  return {
    Header: (props: any) => React.createElement(Text, null, 'Header'),
    CallSummaryDetails: () => React.createElement(Text, null, 'CallSummaryDetails'),
    CallTranscript: () => React.createElement(Text, null, 'CallTranscript'),
    SummaryGenerationProgress: () => React.createElement(Text, null, 'SummaryGenerationProgress'),
    AddNotesSection: () => React.createElement(Text, null, 'AddNotesSection'),
    SummaryModals: () => React.createElement(Text, null, 'SummaryModals'),
  };
});

// Store hooks/selectors
jest.mock('@/store/hooks', () => ({
  useAppSelector: (sel: any) => sel({ 
    chat: { currentChat: null }, 
    user: { permissions: [] } 
  }),
  useAppDispatch: () => jest.fn(),
}));

jest.mock('@/store/slices/summarySlice', () => ({
  selectCallInfo: () => ({ summaryName: '' }),
}));

// Utils
jest.mock('@/utils', () => ({ navigateToCallLogTab: jest.fn() }));

// Services
jest.mock('@/services/settingsApi', () => ({
  useGetSummaryFieldsQuery: () => ({ 
    data: [], 
    isLoading: false,
    refetch: jest.fn(),
  }),
}));

// Constants
jest.mock('@/constants', () => ({ 
  ChatSummaryStatus: { FAILED: 'FAILED', NO_AUDIO: 'NO_AUDIO' },
  USER_PERMISSIONS: { EDIT_SUMMARY_FEEDBACK: 'edit:summary:feedback' }
}));

// Hooks with configurable state for tests
let mockSummaryState: any = {
  isLoading: false,
  refreshing: false,
  summaryData: {},
  showSummary: false,
  setShowSummary: jest.fn(),
  canShowSummary: false,
  activeModal: null,
  setActiveModal: jest.fn(),
  isSummaryAvailable: false,
  handleRefresh: jest.fn(),
  handleNoteChange: jest.fn(),
  summaryStatus: 'IDLE',
};
let mockHasChanges = false;

jest.mock('@/hooks', () => {
  return {
    useAppNavigation: () => ({ navigate: jest.fn() }),
    useCallSummaryActions: () => ({
      handleSummaryNameChange: jest.fn(),
      isMenuVisible: false,
      hideMenu: jest.fn(),
      showMenu: jest.fn(),
      handleExport: jest.fn(),
      handleDelete: jest.fn(),
      handleGoBack: jest.fn(),
      summaryName: '',
      setSummaryName: jest.fn(),
      onHeaderPress: jest.fn(),
      isSummaryDropdownVisible: false,
      hideHeaderDropdown: jest.fn(),
      onAddSummaryFeedback: jest.fn().mockResolvedValue({ data: true }),
    }),
    useCallSummaryForm: () => ({ hasChanges: mockHasChanges }),
    useHardwareBackPressHandler: () => {},
    useSummaryState: () => mockSummaryState,
    useTranslate: () => ({ t: (k: string) => k }),
    __setHooksMock: (state: any, hasChanges: boolean) => {
      mockSummaryState = state;
      mockHasChanges = hasChanges;
    },
  };
});

const baseRoute: any = { params: { callId: 123, fromLogs: true } };

describe('CallSummaryScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // reset to defaults before each test
    const hooks = require('@/hooks') as any;
    hooks.__setHooksMock(
      {
        isLoading: false,
        refreshing: false,
        summaryData: {},
        showSummary: false,
        setShowSummary: jest.fn(),
        canShowSummary: false,
        activeModal: null,
        setActiveModal: jest.fn(),
        isSummaryAvailable: false,
        handleRefresh: jest.fn(),
        handleNoteChange: jest.fn(),
        summaryStatus: 'IDLE',
      },
      false,
    );
  });

  it('renders transcript when showSummary is false', () => {
    const {CallSummaryScreen} = require('@/screens/CallSummaryScreen/CallSummaryScreen');
    const {getByText} = render(
      <CallSummaryScreen route={baseRoute} navigation={{} as any} />,
    );
    expect(getByText('SummaryModals')).toBeTruthy();
    expect(getByText('Header')).toBeTruthy();
    expect(getByText('CallTranscript')).toBeTruthy();
  });

  it('renders CallSummaryDetails when showSummary and canShowSummary are true', () => {
    const hooks = require('@/hooks') as any;
    hooks.__setHooksMock(
      {
        isLoading: false,
        refreshing: false,
        summaryData: {},
        showSummary: true,
        setShowSummary: jest.fn(),
        canShowSummary: true,
        activeModal: null,
        setActiveModal: jest.fn(),
        isSummaryAvailable: true,
        handleRefresh: jest.fn(),
        handleNoteChange: jest.fn(),
        summaryStatus: 'DONE',
      },
      true,
    );

    const {CallSummaryScreen} = require('@/screens/CallSummaryScreen/CallSummaryScreen');
    const {getByText, unmount} = render(
      <CallSummaryScreen route={baseRoute} navigation={{} as any} />,
    );
    expect(getByText('CallSummaryDetails')).toBeTruthy();
    unmount();
  });

  it('shows progress + notes + buttons when showSummary=true but cannot show summary yet', () => {
    const hooks = require('@/hooks') as any;
    hooks.__setHooksMock(
      {
        isLoading: false,
        refreshing: false,
        summaryData: {details: {callInfo: {notes: 'n'}}},
        showSummary: true,
        setShowSummary: jest.fn(),
        canShowSummary: false,
        activeModal: null,
        setActiveModal: jest.fn(),
        isSummaryAvailable: true,
        handleRefresh: jest.fn(),
        handleNoteChange: jest.fn(),
        summaryStatus: 'IN_PROGRESS',
      },
      false,
    );
    const {CallSummaryScreen} = require('@/screens/CallSummaryScreen/CallSummaryScreen');
    const {getByText} = render(
      <CallSummaryScreen route={{params: {callId: 123, fromLogs: true}} as any} navigation={{} as any} />,
    );
    expect(getByText('SummaryGenerationProgress')).toBeTruthy();
    expect(getByText('AddNotesSection')).toBeTruthy();
  });

  it('renders action button text depending on status', () => {
    const hooks = require('@/hooks') as any;
    // case: summary available but cannot show yet -> shows setting up text
    hooks.__setHooksMock(
      {
        isLoading: false,
        refreshing: false,
        summaryData: {},
        showSummary: true,
        setShowSummary: jest.fn(),
        canShowSummary: false,
        activeModal: null,
        setActiveModal: jest.fn(),
        isSummaryAvailable: true,
        handleRefresh: jest.fn(),
        handleNoteChange: jest.fn(),
        summaryStatus: 'IDLE',
      },
      false,
    );
    const {CallSummaryScreen} = require('@/screens/CallSummaryScreen/CallSummaryScreen');
    const {getByText, rerender} = render(
      <CallSummaryScreen route={{params: {callId: 1, fromLogs: true}} as any} navigation={{} as any} />,
    );
    expect(getByText('CallSummaryProgress.settingUpSummaryScreen')).toBeTruthy();

    // case: failed -> retry label
    hooks.__setHooksMock(
      {
        isLoading: false,
        refreshing: false,
        summaryData: {},
        showSummary: true,
        setShowSummary: jest.fn(),
        canShowSummary: false,
        activeModal: null,
        setActiveModal: jest.fn(),
        isSummaryAvailable: false,
        handleRefresh: jest.fn(),
        handleNoteChange: jest.fn(),
        summaryStatus: 'FAILED',
      },
      false,
    );
    rerender(<CallSummaryScreen route={{params: {callId: 1, fromLogs: true}} as any} navigation={{} as any} />);
    expect(getByText('CallSummaryProgress.retry')).toBeTruthy();
  });
});
