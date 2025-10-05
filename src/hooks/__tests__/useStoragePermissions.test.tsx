import React from 'react';
import {Platform, Text} from 'react-native';
import {render} from '@testing-library/react-native';

import {useStoragePermissions} from '../useStoragePermissions';

jest.mock('react-native-permissions', () => ({
  RESULTS: {DENIED: 'denied', GRANTED: 'granted'},
  PERMISSIONS: {
    ANDROID: {WRITE_EXTERNAL_STORAGE: 'WRITE_EXTERNAL_STORAGE', RECORD_AUDIO: 'RECORD_AUDIO'},
    IOS: {MICROPHONE: 'MICROPHONE'},
  },
  check: jest.fn(async () => 'denied'),
  request: jest.fn(async () => 'granted'),
  openSettings: jest.fn(async () => undefined),
}));

jest.mock('@/components', () => ({
  useToast: () => ({showToast: jest.fn()}),
}));

jest.mock('../useTranslate', () => ({
  useTranslate: () => ({t: (k: string) => k}),
}));

const TestComponent = () => {
  const {checkAndRequestPermissions} = useStoragePermissions();
  const [result, setResult] = React.useState<null | boolean>(null);
  React.useEffect(() => {
    (async () => {
      const res = await checkAndRequestPermissions();
      setResult(res);
    })();
  }, [checkAndRequestPermissions]);
  return <Text>{String(result)}</Text>;
};

describe('useStoragePermissions', () => {
  it('grants on Android <33 with request path', async () => {
    jest.spyOn(Platform, 'Version', 'get').mockReturnValue(32 as any);
    const {findByText} = render(<TestComponent />);
    expect(await findByText('true')).toBeTruthy();
  });

  it('returns true on iOS without checks', async () => {
    // Set platform to iOS
    (Platform as any).OS = 'ios';
    jest.spyOn(Platform, 'Version', 'get').mockReturnValue('17.0' as any);
    const {findByText} = render(<TestComponent />);
    expect(await findByText('true')).toBeTruthy();
  });
});


