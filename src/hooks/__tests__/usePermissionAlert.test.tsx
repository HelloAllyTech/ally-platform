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
          <Text testID="generic" onPress={() => showSettingsAlert('Title', 'Message')} />
          <Text testID="micro" onPress={() => showMicrophoneSettingsAlert()} />
        </>
      );
    };

    const {getByTestId} = render(<Test />);

    fireEvent.press(getByTestId('generic'));
    expect(alertSpy).toHaveBeenCalledWith('Title', 'Message', expect.any(Array));

    fireEvent.press(getByTestId('micro'));
    expect(alertSpy).toHaveBeenCalledWith(
      'Common.permissions.microphoneRequired',
      'Common.permissions.microphoneMessage',
      expect.any(Array),
    );

    alertSpy.mockRestore();
  });
});


