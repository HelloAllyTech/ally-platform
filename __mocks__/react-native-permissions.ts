export const PERMISSIONS = {
  IOS: {
    MICROPHONE: 'ios.permission.MICROPHONE',
    CAMERA: 'ios.permission.CAMERA',
  },
  ANDROID: {
    RECORD_AUDIO: 'android.permission.RECORD_AUDIO',
    CAMERA: 'android.permission.CAMERA',
  },
};

export const RESULTS = {
  UNAVAILABLE: 'unavailable',
  DENIED: 'denied',
  GRANTED: 'granted',
  BLOCKED: 'blocked',
};

export const check = jest.fn().mockResolvedValue(RESULTS.GRANTED);
export const request = jest.fn().mockResolvedValue(RESULTS.GRANTED);
export const checkMultiple = jest.fn().mockResolvedValue({});
export const requestMultiple = jest.fn().mockResolvedValue({});
export const openSettings = jest.fn().mockResolvedValue();
export const checkNotifications = jest.fn().mockResolvedValue({});
export const requestNotifications = jest.fn().mockResolvedValue({});

export default {
  PERMISSIONS,
  RESULTS,
  check,
  request,
  checkMultiple,
  requestMultiple,
  openSettings,
  checkNotifications,
  requestNotifications,
};
