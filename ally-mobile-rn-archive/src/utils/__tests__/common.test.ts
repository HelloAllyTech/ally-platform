import Clipboard from '@react-native-clipboard/clipboard';
import {Linking} from 'react-native';

import {
  copyToClipboard,
  openAppStore,
  tryParseJson,
  uint8ToString,
} from '../common';

jest.mock('@react-native-clipboard/clipboard', () => ({
  setString: jest.fn(),
}));

jest.mock('react-native', () => ({
  Linking: {
    openURL: jest.fn(),
  },
  Platform: {
    select: jest.fn().mockReturnValue('mock-url'),
  },
  Dimensions: {
    get: jest.fn(
      dim =>
        ({
          window: {
            width: 375,
            height: 812,
            scale: 1,
            fontScale: 1,
          },
          screen: {
            width: 375,
            height: 812,
            scale: 1,
            fontScale: 1,
          },
        })[dim],
    ),
    set: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  },
}));

jest.mock('react-native-size-matters', () => ({
  ms: jest.fn().mockReturnValue(10),
}));

describe('Common Utilities', () => {
  it('should parse valid JSON string', () => {
    const jsonString = '{"key":"value"}';
    expect(tryParseJson(jsonString)).toEqual({key: 'value'});
  });

  it('should return null for invalid JSON string', () => {
    const jsonString = '{key:value}';
    expect(tryParseJson(jsonString)).toBeNull();
  });

  it('should convert Uint8Array to string', () => {
    const bytes = new Uint8Array([72, 101, 108, 108, 111]);
    expect(uint8ToString(bytes)).toBe('Hello');
  });

  it('should copy text to clipboard', () => {
    copyToClipboard('text');
    expect(Clipboard.setString).toHaveBeenCalledWith('text');
  });

  it('should open app store URL', async () => {
    await openAppStore();
    expect(Linking.openURL).toHaveBeenCalledWith('mock-url');
  });

});
