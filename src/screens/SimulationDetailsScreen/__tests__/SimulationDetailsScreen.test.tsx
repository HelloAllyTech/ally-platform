import React from 'react';
import {render, fireEvent, waitFor, act} from '@testing-library/react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';

import {SimulationDetailsScreen} from '../SimulationDetailsScreen';
import {SCREEN_NAMES} from '../../../constants';

jest.mock('@/hooks', () => {
  const mockNavigate = jest.fn();
  const mockGoBack = jest.fn();
  const mockShowSettingsAlert = jest.fn();
  const mockShowToast = jest.fn();
  const mockShowErrorToast = jest.fn();
  return {
    __esModule: true,
    useAppNavigation: () => ({navigate: mockNavigate, goBack: mockGoBack}),
    useHardwareBackPressHandler: () => {},
    usePermissionAlert: () => ({showSettingsAlert: mockShowSettingsAlert}),
    useToast: () => ({showToast: mockShowToast}),
    useErrorToast: () => ({showErrorToast: mockShowErrorToast}),
    useTranslate: () => ({t: (k: string) => k}),
    useSimulationCredits: () => ({ credits: null, getCreditsInfo: null }),
    // expose for assertions
    mockNavigate,
    mockGoBack,
    mockShowSettingsAlert,
    mockShowToast,
    mockShowErrorToast,
  } as any;
});

jest.mock('@/components', () => {
  const React = require('react');
  const {TouchableOpacity, Text} = require('react-native');
  const mockShowToast = jest.fn();
  const mockShowErrorToast = jest.fn();
  return {
    __esModule: true,
    PrimaryButton: ({label, onPress, isLoading}: any) => (
      <TouchableOpacity testID="primary-button" accessibilityState={{busy: !!isLoading}} onPress={onPress}>
        <Text>{label}</Text>
      </TouchableOpacity>
    ),
    IllustratedModal: () => null,
    useToast: () => ({showToast: mockShowToast}),
    useErrorToast: () => ({showErrorToast: mockShowErrorToast}),
    __mocks: {mockShowToast, mockShowErrorToast},
  };
});

// Path alias safe re-mock for the components barrel above
jest.mock('../components', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    __esModule: true,
    ActiveSimulationModal: (props: any) => (props.visible ? <View testID="active-sim-modal" /> : null),
  };
});

// Mock services with configurable unwrap behavior
jest.mock('@/services', () => {
  let unwrapImpl: () => Promise<any> = () => Promise.resolve(null);
  const trigger = jest.fn(() => ({unwrap: jest.fn(() => unwrapImpl())}));
  return {
    __esModule: true,
    useStartScenarioSessionMutation: () => [trigger],
    __setStartUnwrap: (impl: () => Promise<any>) => {
      unwrapImpl = impl;
    },
    __triggerStart: trigger,
  } as any;
});

jest.mock('@/utils', () => ({
  __esModule: true,
  copyToClipboard: jest.fn(),
}));

// Use manual mock for react-native-permissions
jest.mock('react-native-permissions');

describe('SimulationDetailsScreen', () => {
  const renderWithSafeArea = (ui: React.ReactElement) =>
    render(
      <SafeAreaProvider
        initialMetrics={{
          frame: {x: 0, y: 0, width: 375, height: 812},
          insets: {top: 0, left: 0, right: 0, bottom: 0},
        }}>
        {ui}
      </SafeAreaProvider>,
    );

  const scenario = {
    id: '123',
    title: 'Test Scenario',
    scenario: 'Scenario',
    description: 'Description',
    coverImageUrl: undefined,
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    const perms = require('react-native-permissions');
    perms.check.mockResolvedValue(perms.RESULTS.GRANTED);
    perms.request.mockResolvedValue(perms.RESULTS.GRANTED);
  });

  it('navigates to assistant on successful start and shows loading overlay while pending', async () => {
    const {__setStartUnwrap} = require('@/services');

    let resolveStart: (v: any) => void;
    const startResp = {
      scenarioSession: {id: 'room-1', createdAt: '2024-01-01'},
      accessToken: {token: 'token-123', serverUrl: 'wss://lk'},
    };
    const deferred = new Promise(res => {
      resolveStart = res;
    });

    __setStartUnwrap(() => deferred as Promise<any>);

    const {getByTestId, findByText, queryByText} = renderWithSafeArea(
      <SimulationDetailsScreen navigation={{} as any} route={{params: {scenario}} as any} />,
    );

    fireEvent.press(getByTestId('primary-button'));

    // Loading overlay should appear
    expect(await findByText('Simulations.creatingRoom')).toBeTruthy();

    // Resolve start
    await act(async () => {
      // @ts-ignore
      resolveStart!(startResp);
    });

    const {mockNavigate} = require('@/hooks');
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(
        SCREEN_NAMES.SIMULATION_ASSISTANT,
        expect.objectContaining({
          roomData: expect.objectContaining({
            id: startResp.scenarioSession.id,
            accessToken: startResp.accessToken.token,
            liveKitServerUrl: startResp.accessToken.serverUrl,
          }),
          scenario,
        }),
      );
    });

    // Overlay should be gone
    expect(queryByText('Simulations.creatingRoom')).toBeNull();
  });

  it('shows settings alert when microphone permission is blocked', async () => {
    const perms = require('react-native-permissions');
    perms.check.mockResolvedValueOnce(perms.RESULTS.DENIED);
    perms.request.mockResolvedValueOnce(perms.RESULTS.BLOCKED);

    const {__setStartUnwrap} = require('@/services');
    __setStartUnwrap(() => Promise.resolve(null));

    const {getByTestId} = renderWithSafeArea(
      <SimulationDetailsScreen navigation={{} as any} route={{params: {scenario}} as any} />,
    );

    fireEvent.press(getByTestId('primary-button'));

    const {mockShowSettingsAlert, mockNavigate} = require('@/hooks');
    await waitFor(() => expect(mockShowSettingsAlert).toHaveBeenCalled());
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('shows error toast when microphone permission is denied (not blocked)', async () => {
    const perms = require('react-native-permissions');
    perms.check.mockResolvedValueOnce(perms.RESULTS.DENIED);
    perms.request.mockResolvedValueOnce(perms.RESULTS.DENIED);

    const {getByTestId} = renderWithSafeArea(
      <SimulationDetailsScreen navigation={{} as any} route={{params: {scenario}} as any} />,
    );

    fireEvent.press(getByTestId('primary-button'));

    const {__mocks} = require('@/components');
    const {mockNavigate} = require('@/hooks');
    await waitFor(() => expect(__mocks.mockShowErrorToast).toHaveBeenCalled());
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('shows ActiveSimulationModal when API returns existing active session id', async () => {
    const {__setStartUnwrap} = require('@/services');
    __setStartUnwrap(() => Promise.reject({data: {entityId: 'active-1'}}));

    const {getByTestId, findByTestId} = renderWithSafeArea(
      <SimulationDetailsScreen navigation={{} as any} route={{params: {scenario}} as any} />,
    );

    fireEvent.press(getByTestId('primary-button'));

    expect(await findByTestId('active-sim-modal')).toBeTruthy();
  });
});


