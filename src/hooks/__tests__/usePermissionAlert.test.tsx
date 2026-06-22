import React from 'react';
import {Alert, Text} from 'react-native';
import {render, fireEvent} from '@testing-library/react-native';

import {usePermissionAlert} from '../usePermissionAlert';

jest.mock('react-native-permissions', () => ({
  openSettings: jest.fn(),
}));

jest.mock('../useTranslate', () => ({
  useTranslate: () => ({t: (k: string) => k}),
}));

describe('usePermissionAlert', () => {
  it('shows settings alert with translated buttons and callbacks', () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const Test = () => {
      const {showSettingsAlert, showMicrophoneSettingsAlert} = usePermissionAlert();
      return (
        <>
          <Text testID="generic" onPress={() => showSettingsAlert('Common.ok' as any, 'Common.ok' as any)} />
          <Text testID="micro" onPress={() => showMicrophoneSettingsAlert()} />
        </>
      );
    };

    const {getByTestId} = render(<Test />);

    fireEvent.press(getByTestId('generic'));
    expect(alertSpy).toHaveBeenCalledWith('Common.ok', 'Common.ok', expect.any(Array));

    fireEvent.press(getByTestId('micro'));
    expect(alertSpy).toHaveBeenCalledWith(
      'simulationPage.allowMicrophone',
      'simulationPage.microphonePrompt',
      expect.any(Array),
    );

    alertSpy.mockRestore();
  });
});


