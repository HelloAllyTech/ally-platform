import React from 'react';
import {render} from '@testing-library/react-native';

// Mock Google Sign-In to avoid native module requirement
jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    configure: jest.fn(),
    hasPlayServices: jest.fn(),
    signIn: jest.fn(),
  },
  statusCodes: {
    SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED',
    IN_PROGRESS: 'IN_PROGRESS',
    PLAY_SERVICES_NOT_AVAILABLE: 'PLAY_SERVICES_NOT_AVAILABLE',
  },
}));

// Mock RTK Query api to avoid circular import issues in tests
jest.mock('@/services/api', () => ({
  api: {
    reducerPath: 'api',
    reducer: (state: any = {}) => state,
    middleware: () => (next: any) => (action: any) => next(action),
    injectEndpoints: () => ({
      useLazyGetCallSummaryQuery: () => [jest.fn(), {}],
      useUpdateCallSummaryMutation: () => [jest.fn(), {}],
      useLazyExportCallSummaryQuery: () => [jest.fn(), {}],
      useUpdateCallInfoMutation: () => [jest.fn(), {}],
      useEnhanceCallSummaryMutation: () => [jest.fn(), {}],
      useGetTagsMutation: () => [jest.fn(), {}],
      useAddSummaryFeedbackMutation: () => [jest.fn(), {}],
    }),
  },
}));

// Stub @livekit/react-native imports if needed by any sub-component
jest.mock('@livekit/react-native', () => ({
  AndroidAudioTypePresets: { media: {} },
  AudioSession: { configureAudio: jest.fn() },
}));

// Guard: if any hook attempts to import live audio stream, stub it
jest.mock('@/hooks/useLiveAudioStream', () => ({
  useLiveAudioStream: () => ({
    isRecording: false,
    startRecording: jest.fn(),
    stopRecording: jest.fn(),
  }),
}));

jest.mock('@/components', () => {
  const React = require('react');
  const {Text} = require('react-native');
  return {
    FeedbackPopup: ({note}: any) => <Text>{note}</Text>,
    DropdownMenu: ({items}: any) => <Text>{items?.[0]?.text || 'dropdown'}</Text>,
  };
});

// Mock the CallSummaryScreen components barrel to avoid deep import chains
jest.mock('../../index', () => ({
  SummaryDropdown: () => <>dropdown</>,
  CustomMenuModal: () => <>menu</>,
  DeleteRenameModal: () => <>del</>,
  ArchiveActionModal: () => <>archive</>,
}));

// Also mock safe area context to avoid provider requirement
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// i18n translate passthrough
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

// Mock NetInfo native module used by hooks
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
    fetch: jest.fn(() => Promise.resolve({ isConnected: true })),
  },
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

const {SummaryModals} = require('../SummaryModals');

describe('CallSummaryScreen/SummaryModals', () => {
  it('renders feedback popup note text', () => {
    const {getByText} = render(
      <SummaryModals
        activeModal={null}
        setActiveModal={() => {}}
        handleDelete={() => {}}
        handleBlur={() => {}}
        editedName=""
        setEditedName={() => {}}
        isMenuVisible={false}
        hideMenu={() => {}}
        handleExport={() => {}}
        isSummaryDropdownVisible={false}
        hideHeaderDropdown={() => {}}
        showSummary={false}
        setShowSummary={() => {}}
        isSummaryAvailable={false}
        isSummaryFeedbackPopup
        hideSummaryFeedbackPopup={() => {}}
        onSubmitSummaryFeedback={() => {}}
      />,
    );
    expect(getByText('FeedbackPopup.instructionText')).toBeTruthy();
  });
});


