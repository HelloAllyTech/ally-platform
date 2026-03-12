import React from 'react';
import {render} from '@testing-library/react-native';

// Mock react-navigation focus effect so screen doesn't need NavigationContainer
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (cb: () => void) => {
    if (typeof cb === 'function') cb();
  },
}));

// Mock react-native-tab-view to avoid native module issues
jest.mock('react-native-tab-view', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    TabView: ({renderScene, navigationState}: any) => {
      const activeRoute = navigationState.routes[navigationState.index];
      return React.createElement(View, null, renderScene({route: activeRoute}));
    },
    TabBar: () => null,
  };
});

// Mock components barrel items used by screen
jest.mock('@/components', () => {
  const React = require('react');
  const {Text} = require('react-native');
  return {
    Button: ({onPress, label}: any) => React.createElement(Text, {onPress}, label),
    useToast: () => ({showToast: jest.fn()}),
  };
});

// Mock per-screen subcomponents to simple text markers
jest.mock('@/screens/CallSummaryScreen/components', () => {
  const React = require('react');
  const {Text} = require('react-native');
  return {
    Header: () => React.createElement(Text, null, 'Header'),
    CallSummaryDetails: () => React.createElement(Text, null, 'CallSummaryDetails'),
    CallTranscript: () => React.createElement(Text, null, 'CallTranscript'),
    SummaryGenerationProgress: () =>
      React.createElement(Text, null, 'SummaryGenerationProgress'),
    AddNotesSection: () => React.createElement(Text, null, 'AddNotesSection'),
    SummaryModals: () => React.createElement(Text, null, 'SummaryModals'),
    SummaryUnauthorized: () => React.createElement(Text, null, 'SummaryUnauthorized'),
  };
});

// Store hooks/selectors
jest.mock('@/store/hooks', () => ({
  useAppSelector: (sel: any) =>
    sel({
      chat: {currentChat: null},
      user: {permissions: ['view:messages']},
    }),
  useAppDispatch: () => jest.fn(),
}));

jest.mock('@/store/slices/summarySlice', () => ({
  selectCallInfo: () => ({summaryName: ''}),
}));

// Utils
jest.mock('@/utils', () => ({navigateToCallLogTab: jest.fn()}));

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
  ChatSummaryStatus: {FAILED: 'FAILED', NO_AUDIO: 'NO_AUDIO'},
  USER_PERMISSIONS: {
    EDIT_SUMMARY_FEEDBACK: 'edit:summary:feedback',
    VIEW_MESSAGES: 'view:messages',
  },
}));

let mockSummaryState: any = {
  isLoading: false,
  refreshing: false,
  summaryData: {},
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
    useAppNavigation: () => ({navigate: jest.fn()}),
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
      onAddSummaryFeedback: jest.fn().mockResolvedValue({data: true}),
    }),
    useCallSummaryForm: () => ({hasChanges: mockHasChanges}),
    useHardwareBackPressHandler: () => {},
    useSummaryState: () => mockSummaryState,
    useToggleReviewPrivacy: () => ({handleTogglePrivate: jest.fn()}),
    useTranslate: () => ({t: (k: string) => k}),
    __setHooksMock: (state: any, hasChanges: boolean) => {
      mockSummaryState = state;
      mockHasChanges = hasChanges;
    },
  };
});

const baseRoute: any = {params: {callId: 123, fromLogs: true}};

describe('CallSummaryScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const hooks = require('@/hooks') as any;
    hooks.__setHooksMock(
      {
        isLoading: false,
        refreshing: false,
        summaryData: {},
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

  it('renders header and summary tab by default', () => {
    const {CallSummaryScreen} = require('@/screens/CallSummaryScreen/CallSummaryScreen');
    const {getByText} = render(
      <CallSummaryScreen route={baseRoute} navigation={{} as any} />,
    );
    expect(getByText('SummaryModals')).toBeTruthy();
    expect(getByText('Header')).toBeTruthy();
  });

  it('renders CallSummaryDetails when summary is available and can be shown', () => {
    const hooks = require('@/hooks') as any;
    hooks.__setHooksMock(
      {
        isLoading: false,
        refreshing: false,
        summaryData: {},
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

  it('shows progress + notes when summary is generating', () => {
    const hooks = require('@/hooks') as any;
    hooks.__setHooksMock(
      {
        isLoading: false,
        refreshing: false,
        summaryData: {details: {callInfo: {notes: 'n'}}},
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
      <CallSummaryScreen
        route={{params: {callId: 123, fromLogs: true}} as any}
        navigation={{} as any}
      />,
    );
    expect(getByText('SummaryGenerationProgress')).toBeTruthy();
    expect(getByText('AddNotesSection')).toBeTruthy();
  });

  it('shows setting up text when summary available but not ready to display', () => {
    const hooks = require('@/hooks') as any;
    hooks.__setHooksMock(
      {
        isLoading: false,
        refreshing: false,
        summaryData: {},
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
    const {getByText} = render(
      <CallSummaryScreen
        route={{params: {callId: 1, fromLogs: true}} as any}
        navigation={{} as any}
      />,
    );
    expect(getByText('CallSummaryProgress.settingUpSummaryScreen')).toBeTruthy();
  });

  it('shows retry label when summary has failed', () => {
    const hooks = require('@/hooks') as any;
    hooks.__setHooksMock(
      {
        isLoading: false,
        refreshing: false,
        summaryData: {},
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
    const {CallSummaryScreen} = require('@/screens/CallSummaryScreen/CallSummaryScreen');
    const {getByText} = render(
      <CallSummaryScreen
        route={{params: {callId: 1, fromLogs: true}} as any}
        navigation={{} as any}
      />,
    );
    expect(getByText('CallSummaryProgress.retry')).toBeTruthy();
  });
});
