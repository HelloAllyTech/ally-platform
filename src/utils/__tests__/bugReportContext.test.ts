import {Platform} from 'react-native';
import VersionCheck from 'react-native-version-check';

import {getBugReportContext} from '../bugReportContext';

// `Platform.constants` and `Platform.Version` are getter-only in RN's test
// environment — override via Object.defineProperty, same technique used in
// notificationService.test.ts.
const setPlatformConstants = (constants: Record<string, unknown>) => {
  Object.defineProperty(Platform, 'constants', {
    value: constants,
    configurable: true,
    writable: true,
  });
};

describe('getBugReportContext', () => {
  beforeEach(() => {
    jest.spyOn(VersionCheck, 'getCurrentVersion').mockReturnValue('1.5.0');
    jest.useFakeTimers().setSystemTime(new Date('2026-08-18T12:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('includes the screen name when provided', () => {
    (Platform as any).OS = 'android';
    setPlatformConstants({Brand: 'Google', Model: 'Pixel 7'});

    const context = getBugReportContext('CallLog');
    expect(context.screen).toBe('CallLog');
  });

  it('omits screen when not provided', () => {
    (Platform as any).OS = 'android';
    setPlatformConstants({Brand: 'Google', Model: 'Pixel 7'});

    const context = getBugReportContext();
    expect(context.screen).toBeUndefined();
  });

  it('reads Brand + Model as the device label on Android', () => {
    (Platform as any).OS = 'android';
    setPlatformConstants({Brand: 'Google', Model: 'Pixel 7'});

    const context = getBugReportContext();
    expect(context.device).toBe('Google Pixel 7');
  });

  it('falls back to a generic label on iOS, since there is no device-info dependency', () => {
    (Platform as any).OS = 'ios';
    setPlatformConstants({interfaceIdiom: 'phone', osVersion: '17.4'});

    const context = getBugReportContext();
    expect(context.device).toBe('iPhone');
  });

  it('labels an iPad by interfaceIdiom', () => {
    (Platform as any).OS = 'ios';
    setPlatformConstants({interfaceIdiom: 'pad', osVersion: '17.4'});

    const context = getBugReportContext();
    expect(context.device).toBe('iPad');
  });

  it('builds the os label from Platform.OS + Platform.Version', () => {
    (Platform as any).OS = 'android';
    setPlatformConstants({Brand: 'Google', Model: 'Pixel 7', Version: 34});
    Object.defineProperty(Platform, 'Version', {
      value: 34,
      configurable: true,
      writable: true,
    });

    const context = getBugReportContext();
    expect(context.os).toBe('Android 34');
  });

  it('includes the app version and an ISO client timestamp', () => {
    (Platform as any).OS = 'android';
    setPlatformConstants({Brand: 'Google', Model: 'Pixel 7'});

    const context = getBugReportContext();
    expect(context.appVersion).toBe('1.5.0');
    expect(context.clientTimestamp).toBe('2026-08-18T12:00:00.000Z');
  });
});
