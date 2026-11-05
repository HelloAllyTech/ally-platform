import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({t: (key: string) => key}),
}));

jest.mock('@/hooks', () => ({
  useTranslate: () => ({t: (key: string) => key}),
}));

jest.mock('react-native-size-matters', () => ({
  ScaledSheet: {create: (s: unknown) => s},
}));

jest.mock('@/assets', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    CloseIcon: (props: any) => <View testID="close-icon" {...props} />,
  };
});

jest.mock('@/components', () => {
  const React = require('react');
  const {View, Text, TouchableOpacity} = require('react-native');
  return {
    Button: ({label, onPress, isLoading}: any) => (
      <TouchableOpacity testID="start-button" onPress={onPress} disabled={isLoading}>
        <Text>{label}</Text>
      </TouchableOpacity>
    ),
    CustomDropdown: ({value}: any) => (
      <View testID="custom-dropdown">
        <Text>{value}</Text>
      </View>
    ),
    VideoPreview: () => <View testID="video-preview" />,
  };
});

jest.mock('@/constants', () => ({isIOS: false}));

jest.mock('@/theme', () => ({
  colors: {
    ds: {
      blackAlpha: {700: 'rgba(0,0,0,0.7)'},
      neutral: {white: '#fff'},
      typography: {highEmphasis: '#111', mediumEmphasis: '#666', lowEmphasis: '#999'},
      stroke: {primary: '#ccc'},
      grey: {50: '#fafafa', 200: '#eee', 300: '#ddd'},
    },
  },
  fontFamily: {
    REPLAY_PRO: {HEADLINE: {}, BOLD_ITALIC: {}},
    IBM_PLEX_SERIF: {REGULAR: {}, MEDIUM: {}},
    ROBOTO: {REGULAR: {}},
  },
  fontWeights: {light: '300', regular: '400'},
  radius: {lg: 12, full: 999},
  typography: {display: {small: {}}, body: {small: {}, medium: {}, large: {}}, label: {large: {}}},
}));

jest.mock('@/utils', () => ({
  getTriggerWarningNames: (warnings: any[]) =>
    warnings ? warnings.map((w: any) => w.name || w) : [],
}));

import {SimulationDetailsModal} from '../SimulationDetailsModal';

describe('SimulationDetailsModal', () => {
  const defaultProps = {
    visible: true,
    onClose: jest.fn(),
    title: 'Test Simulation',
    description: 'Test description',
    order: 1,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders title and description when visible', () => {
    const {getByText} = render(<SimulationDetailsModal {...defaultProps} />);

    expect(getByText('Test Simulation')).toBeTruthy();
    expect(getByText('Test description')).toBeTruthy();
  });

  it('renders order label', () => {
    const {getByText} = render(<SimulationDetailsModal {...defaultProps} />);

    expect(getByText('common.simulation 1')).toBeTruthy();
  });

  it('renders start button when onStartSimulation is provided', () => {
    const onStart = jest.fn();
    const {getByTestId} = render(
      <SimulationDetailsModal {...defaultProps} onStartSimulation={onStart} />,
    );

    const btn = getByTestId('start-button');
    fireEvent.press(btn);
    expect(onStart).toHaveBeenCalled();
  });

  it('does not render start button when onStartSimulation is not provided', () => {
    const {queryByTestId} = render(
      <SimulationDetailsModal {...defaultProps} />,
    );

    expect(queryByTestId('start-button')).toBeNull();
  });

  it('calls onClose when close button is pressed', () => {
    const onClose = jest.fn();
    const {getByTestId} = render(
      <SimulationDetailsModal {...defaultProps} onClose={onClose} />,
    );

    fireEvent.press(getByTestId('close-icon').parent!);
    expect(onClose).toHaveBeenCalled();
  });

  it('renders trigger warning chips', () => {
    const {getByText} = render(
      <SimulationDetailsModal
        {...defaultProps}
        triggerWarnings={[{name: 'Violence'}, {name: 'Abuse'}] as any}
      />,
    );

    expect(getByText('Violence')).toBeTruthy();
    expect(getByText('Abuse')).toBeTruthy();
  });

  it('renders language dropdown when options are provided', () => {
    const {getByTestId} = render(
      <SimulationDetailsModal
        {...defaultProps}
        languageOptions={['English', 'Spanish']}
        selectedLanguage="English"
        onLanguageSelect={jest.fn()}
      />,
    );

    expect(getByTestId('custom-dropdown')).toBeTruthy();
  });

  it('renders custom header title when provided', () => {
    const {getByText} = render(
      <SimulationDetailsModal {...defaultProps} headerTitle="Custom Header" />,
    );

    expect(getByText('Custom Header')).toBeTruthy();
  });
});
