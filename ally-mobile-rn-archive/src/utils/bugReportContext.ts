import {Platform} from 'react-native';

import {getAppVersion} from './version';

export interface BugReportContext {
  screen?: string;
  appVersion?: string;
  device?: string;
  os?: string;
  clientTimestamp?: string;
}

/**
 * Best-effort device label using only React Native core APIs — this app has no
 * device-info dependency (react-native-device-info / expo-device) installed.
 * Android's `Platform.constants` exposes a real Brand + Model (e.g. "Google Pixel 7").
 * iOS's `Platform.constants` has no model identifier, only `interfaceIdiom`
 * (phone/pad/tv), so the best we get there is a device family, not a model name.
 */
const getDeviceLabel = (): string => {
  if (Platform.OS === 'android') {
    const {Brand, Model} = Platform.constants as {
      Brand?: string;
      Model?: string;
    };
    return [Brand, Model].filter(Boolean).join(' ').trim() || 'Android device';
  }

  const idiom = (Platform.constants as {interfaceIdiom?: string})
    .interfaceIdiom;
  switch (idiom) {
    case 'pad':
      return 'iPad';
    case 'tv':
      return 'Apple TV';
    case 'vision':
      return 'Apple Vision';
    default:
      return 'iPhone';
  }
};

const getOsLabel = (): string => {
  const osName = Platform.OS === 'ios' ? 'iOS' : 'Android';
  return `${osName} ${Platform.Version}`;
};

/**
 * Silently gathers diagnostic context for a bug report — never shown to the
 * user, just attached to the submission to help triage.
 */
export const getBugReportContext = (screen?: string): BugReportContext => ({
  ...(screen ? {screen} : {}),
  appVersion: getAppVersion(),
  device: getDeviceLabel(),
  os: getOsLabel(),
  clientTimestamp: new Date().toISOString(),
});
