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
  const {TouchableOpacity, Text} = require('react-native');
  return {
    __esModule: true,
    PrimaryButton: ({label, onPress, isLoading}: any) => (
      <TouchableOpacity
        testID="primary-button"
        accessibilityState={{busy: !!isLoading}}
        onPress={onPress}>
        <Text>{label}</Text>
      </TouchableOpacity>
    ),
    IllustratedModal: () => null,
    useToast: () => ({showToast: jest.fn()}),
    VideoPreview: () => null,
  };
});

jest.mock('../components', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    __esModule: true,
    ActiveSimulationModal: (props: any) =>
      props.visible ? <View testID="active-sim-modal" /> : null,
  };
});

jest.mock('@/utils', () => ({
  __esModule: true,
  copyToClipboard: jest.fn(),
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

  it('calls startSimulation from hook when button is pressed', async () => {
    const {getByTestId} = renderWithSafeArea(
      <SimulationDetailsScreen
        navigation={{} as any}
        route={{params: {scenario}} as any}
      />,
    );

    const button = getByTestId('primary-button');
    fireEvent.press(button);

    await waitFor(() => {
      expect(mockStartSimulation).toHaveBeenCalledWith(scenario);
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
