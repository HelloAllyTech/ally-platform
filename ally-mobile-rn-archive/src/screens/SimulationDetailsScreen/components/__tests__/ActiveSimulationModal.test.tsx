import React from 'react';
import {render, fireEvent, waitFor} from '@testing-library/react-native';

import {ActiveSimulationModal} from '../ActiveSimulationModal';

jest.mock('@/components', () => {
  const React = require('react');
  const {TouchableOpacity, View, Text} = require('react-native');
  return {
    __esModule: true,
    IllustratedActionModal: ({visible, titleMain, titleItalic, description, actions}: any) =>
      visible ? (
        <View testID="illustrated-modal">
          <Text>{titleMain}</Text>
          <Text>{titleItalic}</Text>
          <Text>{description}</Text>
          {actions?.map((a: any, idx: number) => (
            <TouchableOpacity key={idx} testID={`action-${idx}`} onPress={a.onPress}>
              <Text>{a.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null,
    useErrorToast: () => ({showErrorToast: jest.fn()}),
    useToast: () => ({showToast: jest.fn()}),
  };
});

jest.mock('@/assets/icons', () => ({
  __esModule: true,
  RunningSimulationIcon: () => null,
}));

jest.mock('@/services', () => {
  let resolveValue: any = {error: undefined};
  const trigger = jest.fn(() => Promise.resolve(resolveValue));
  return {
    __esModule: true,
    useEndScenarioSessionMutation: () => [trigger],
    __setResolveValue: (v: any) => (resolveValue = v),
    __trigger: trigger,
  } as any;
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({t: (k: string) => k}),
}));

describe('ActiveSimulationModal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('invokes onClose when cancel action is pressed', () => {
    const onClose = jest.fn();
    const {getByTestId} = render(
      <ActiveSimulationModal visible onClose={onClose} scenarioSessionId="id-1" />,
    );
    fireEvent.press(getByTestId('action-0'));
    expect(onClose).toHaveBeenCalled();
  });

  it('shows success toast when ending session succeeds and calls onClose', async () => {
    const services = require('@/services');
    services.__setResolveValue({error: undefined});

    const {getByTestId} = render(
      <ActiveSimulationModal visible onClose={jest.fn()} scenarioSessionId="id-1" />,
    );

    fireEvent.press(getByTestId('action-1'));

    // assert it called mutation
    await waitFor(() => {
      expect(services.__trigger).toHaveBeenCalledWith({scenarioSessionId: 'id-1'});
    });
  });

  it('shows error toast when ending session returns error', async () => {
    const services = require('@/services');
    services.__setResolveValue({error: new Error('fail')});

    const {getByTestId} = render(
      <ActiveSimulationModal visible onClose={jest.fn()} scenarioSessionId="id-1" />,
    );

    fireEvent.press(getByTestId('action-1'));

    await waitFor(() => {
      expect(services.__trigger).toHaveBeenCalled();
    });

  });
});


