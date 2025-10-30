// Mock @testing-library/jest-native
jest.mock('@testing-library/jest-native/extend-expect', () => {
  // Empty mock to prevent loading the actual module
});

// Mock react-native components and modules
jest.mock('react-native', () => {
  const React = require('react');
  const RN = jest.requireActual('react-native');

  RN.NativeEventEmitter = jest.fn().mockImplementation(() => ({
    addListener: jest.fn(),
    removeListener: jest.fn(),
  }));

  RN.Platform = {
    OS: 'ios',
    Version: 13,
    isPad: false,
    isTV: false,
    isTesting: true,
    select: jest.fn(obj => obj.ios),
  };

  RN.Dimensions = {
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
  };

  RN.NativeModules = {};
  RN.TurboModuleRegistry = {
    get: jest.fn(),
    getEnforcing: jest.fn(),
  };

  RN.StyleSheet = {
    create: jest.fn(styles => styles),
    flatten: jest.fn(),
  };

  RN.I18nManager = {
    isRTL: false,
  };

  // Mock basic React Native components
  RN.TouchableOpacity = ({children, ...props}) =>
    React.createElement('TouchableOpacity', props, children);
  RN.Text = ({children, ...props}) =>
    React.createElement('Text', props, children);
  RN.ActivityIndicator = ({...props}) =>
    React.createElement('ActivityIndicator', props);

  return RN;
});

// Silence react-native-reanimated warnings in tests
jest.mock('react-native-reanimated', () =>
  require('react-native-reanimated/mock'),
);

// Basic mock for react-native-svg import of svgs
jest.mock('react-native-svg', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: (props: any) => React.createElement('svg', props),
  };
});

// Note: NativeAnimatedHelper mock is not needed on RN 0.79

// Mock react-native-config
jest.mock('react-native-config', () => {
  return {
    __esModule: true,
    default: {
      ENVIRONMENT: 'test',
      API_BASE_URL: 'https://test-api.example.com',
      API_VERSION: 'v1',
      ALLY_WEB_URL: 'https://test.example.com',
      THIRD_PARTY_CALL_NUMBER: '+1234567890',
      MICROPHONE_SOCKET_PATH: '/test/socket',
      CLOUD_TELEPHONY_PATH: '/test/telephony',
    },
  };
});

// Mock AsyncStorage
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// Mock react-native-size-matters
jest.mock('react-native-size-matters', () => ({
  ms: jest.fn().mockImplementation(size => size),
  vs: jest.fn().mockImplementation(size => size),
  s: jest.fn().mockImplementation(size => size),
  mvs: jest.fn().mockImplementation(size => size),
  moderateScale: jest.fn().mockImplementation(size => size),
  ScaledSheet: {
    create: jest.fn(styles => {
      // Process the styles to handle the @ms and @vs annotations
      const processedStyles: Record<string, Record<string, any>> = {};
      Object.entries(styles).forEach(([key, value]) => {
        processedStyles[key] = {};
        Object.entries(value as object).forEach(([propKey, propValue]) => {
          if (typeof propValue === 'string' && propValue.includes('@')) {
            // Extract the number from strings like '11@vs' or '24@ms'
            const number = parseInt(propValue.split('@')[0], 10);
            processedStyles[key][propKey] = number;
          } else {
            processedStyles[key][propKey] = propValue;
          }
        });
      });
      return processedStyles;
    }),
  },
}));
