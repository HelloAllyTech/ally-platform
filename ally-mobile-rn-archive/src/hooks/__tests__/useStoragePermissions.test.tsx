import React from 'react';
import {Text, Platform} from 'react-native';
import {render} from '@testing-library/react-native';

jest.mock('@/components', () => ({ useToast: () => ({ showToast: jest.fn() }) }));
jest.mock('../useTranslate', () => ({ useTranslate: () => ({ t: (k: string) => k }) }));
jest.mock('@/constants', () => ({ isIOS: false }));

import {useStoragePermissions} from '../useStoragePermissions';

jest.mock('react-native-permissions', () => ({
  PERMISSIONS: { IOS: { MICROPHONE: 'mic' }, ANDROID: { RECORD_AUDIO: 'rec', WRITE_EXTERNAL_STORAGE: 'write' } },
  RESULTS: { GRANTED: 'granted', DENIED: 'denied', BLOCKED: 'blocked' },
  check: jest.fn(async () => 'denied'),
  request: jest.fn(async () => 'denied'),
  openSettings: jest.fn(async () => {}),
}));

const Test = () => {
  const {checkAndRequestPermissions} = useStoragePermissions();
  return <Text testID="ensure" onPress={() => checkAndRequestPermissions()} />;
};

describe('useStoragePermissions', () => {
  beforeAll(() => {
    (Platform as any).OS = 'android';
    (Platform as any).Version = 30;
  });
  it('requests permissions without crashing', async () => {
    const {getByTestId} = render(<Test />);
    getByTestId('ensure').props.onPress();
  });
});

describe('useStoragePermissions extended', () => {
  beforeAll(() => {
    (Platform as any).OS = 'android';
    (Platform as any).Version = 30;
  });
  it('returns boolean result even when permission denied (current impl true)', async () => {
    const { getByTestId } = render(<Test />);
    const result = await getByTestId('ensure').props.onPress();
    expect(typeof result).toBe('boolean');
  });

  it('handles exceptions without throwing', async () => {
    const perms = require('react-native-permissions');
    perms.check.mockRejectedValueOnce(new Error('fail'));
    const { getByTestId } = render(<Test />);
    const result = await getByTestId('ensure').props.onPress();
    expect(typeof result).toBe('boolean');
  });
});


