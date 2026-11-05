import React from 'react';
import {render, fireEvent, waitFor} from '@testing-library/react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';

import {SimulationDetailsScreen} from '../SimulationDetailsScreen';

// Mock React Navigation hooks
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useIsFocused: jest.fn(() => true),
}));

const mockStartSimulation = jest.fn();
const mockCloseActiveSimulationModal = jest.fn();


jest.mock('@/hooks', () => {
  const mockNavigate = jest.fn();
  const mockGoBack = jest.fn();
  const mockShowToast = jest.fn();
  return {
    __esModule: true,
    useAppNavigation: () => ({navigate: mockNavigate, goBack: mockGoBack}),
    useHardwareBackPressHandler: () => {},
    useToast: () => ({showToast: mockShowToast}),
    useTranslate: () => ({t: (k: string) => k}),
    useSimulationCredits: () => ({credits: null, getCreditsInfo: null}),
    useStartSimulation: () => ({
      isCreatingRoom: false,
      isMicPermissionGranted: true,
      activeSimulationId: null,
      showActiveSimulationModal: false,
      startSimulation: mockStartSimulation,
      closeActiveSimulationModal: mockCloseActiveSimulationModal,
      setShowActiveSimulationModal: jest.fn(),
    }),
  };
});

jest.mock('@/components', () => {
  const React = require('react');
  const {TouchableOpacity, Text, View} = require('react-native');
  return {
    __esModule: true,
    Button: ({label, onPress, isLoading}: any) => (
      <TouchableOpacity
        testID="primary-button"
        accessibilityState={{busy: !!isLoading}}
        onPress={onPress}>
        <Text>{label}</Text>
      </TouchableOpacity>
    ),
    CustomDropdown: ({value, options, onSelect}: any) => (
      <TouchableOpacity
        testID="custom-dropdown"
        onPress={() => onSelect && onSelect(options[0])}>
        <Text>{value || 'Select'}</Text>
      </TouchableOpacity>
    ),
    NotificationModal: ({visible, onConfirm}: any) =>
      visible ? (
        <View testID="notification-modal">
          <Text onPress={onConfirm}>Start Session</Text>
        </View>
      ) : null,
    IllustratedModal: () => null,
    useToast: () => ({showToast: jest.fn()}),
    VideoPreview: () => null,
    RichText: ({html}: any) => <Text>{html}</Text>,
  };
});

jest.mock('../components', () => {
  const React = require('react');
  const {View, Text} = require('react-native');
  return {
    __esModule: true,
    ActiveSimulationModal: (props: any) =>
      props.visible ? <View testID="active-sim-modal" /> : null,
    SimulationDetailsModal: () => null,
  };
});

jest.mock('@/utils', () => ({
  __esModule: true,
  copyToClipboard: jest.fn(),
  getTriggerWarningNames: jest.fn((triggerWarnings) => 
    triggerWarnings?.map((tw: any) => tw.name) || []
  ),
}));

jest.mock('@/services', () => ({
  __esModule: true,
  useGetSimulationDetailsQuery: jest.fn(() => ({
    data: undefined,
    isLoading: false,
    error: undefined,
  })),
  useGetSimulationMetricsQuery: jest.fn(() => ({
    data: undefined,
    isLoading: false,
  })),
}));

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
  });

  it('renders scenario details correctly', () => {
    const {getByText} = renderWithSafeArea(
      <SimulationDetailsScreen
        navigation={{} as any}
        route={{params: {scenario}} as any}
      />,
    );

    expect(getByText('Test Scenario')).toBeTruthy();
    expect(getByText('Description')).toBeTruthy();
  });

  it('calls startSimulation after notification confirmation', async () => {
    const {getByTestId, getByText} = renderWithSafeArea(
      <SimulationDetailsScreen
        navigation={{} as any}
        route={{params: {scenario}} as any}
      />,
    );

    const button = getByTestId('primary-button');
    fireEvent.press(button);

    expect(mockStartSimulation).not.toHaveBeenCalled();

    const notificationButton = getByText('Start Session');
    fireEvent.press(notificationButton);

    await waitFor(() => {
      expect(mockStartSimulation).toHaveBeenCalledWith({
        scenarioId: scenario.id,
      });
    });
  });

  it('renders start simulation button', () => {
    const {getByTestId} = renderWithSafeArea(
      <SimulationDetailsScreen
        navigation={{} as any}
        route={{params: {scenario}} as any}
      />,
    );

    expect(getByTestId('primary-button')).toBeTruthy();
  });
});
