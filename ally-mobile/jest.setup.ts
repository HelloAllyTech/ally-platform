import i18next from 'i18next';
import {initReactI18next} from 'react-i18next';

// Mock @testing-library/jest-native
jest.mock('@testing-library/jest-native/extend-expect', () => {
  // Empty mock to prevent loading the actual module
});

// Initialize a real i18next instance so components that call react-i18next
// directly (useTranslation, Trans) render without triggering the
// "You need to pass in an i18next instance" warning. This uses its own
// instance (rather than the default singleton exported by 'i18next') so it
// doesn't change behaviour for code that imports `t` straight from
// 'i18next' — that singleton stays uninitialized exactly as before. Test
// files that mock 'react-i18next' or '@/hooks' themselves are unaffected —
// this only fills in for suites that don't.
i18next
  .createInstance()
  .use(initReactI18next)
  .init({
    lng: 'en',
    fallbackLng: 'en',
    resources: {en: {translation: {}}},
    interpolation: {escapeValue: false},
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
  RN.TouchableOpacity = (props: {children: React.ReactNode}) =>
    React.createElement('TouchableOpacity', props, props.children);
  RN.View = (props: {children: React.ReactNode}) =>
    React.createElement('View', props, props.children);
  RN.Text = ({children, ...props}: {children: React.ReactNode}) =>
    React.createElement('Text', props, children);
  RN.Image = (props: Record<string, unknown>) =>
    React.createElement('Image', props);
  RN.ActivityIndicator = ({...props}: Record<string, unknown>) =>
    React.createElement('ActivityIndicator', props);

  return RN;
});

// Silence react-native-reanimated warnings in tests
jest.mock('react-native-reanimated', () =>
  require('react-native-reanimated/mock'),
);

// react-native-gesture-handler calls TurboModuleRegistry.getEnforcing() at import
// time, so any suite that transitively pulls it in (every @gorhom/bottom-sheet
// consumer) fails to even load without its shipped mock. This registers that mock
// for every suite; a suite is still free to jest.mock the module itself, which wins.
require('react-native-gesture-handler/jestSetup');

// Mock react-native-svg
jest.mock('react-native-svg', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: (props: React.PropsWithChildren<unknown>) =>
      React.createElement('Svg', props, props.children),
    Svg: (props: React.PropsWithChildren<unknown>) =>
      React.createElement('Svg', props, props.children),
    Circle: (props: Record<string, unknown>) =>
      React.createElement('Circle', props),
    Rect: (props: Record<string, unknown>) =>
      React.createElement('Rect', props),
    Path: (props: Record<string, unknown>) =>
      React.createElement('Path', props),
    Line: (props: Record<string, unknown>) =>
      React.createElement('Line', props),
    G: (props: React.PropsWithChildren<unknown>) =>
      React.createElement('G', props, props.children),
    Text: (props: React.PropsWithChildren<unknown>) =>
      React.createElement('SvgText', props, props.children),
    Defs: (props: React.PropsWithChildren<unknown>) =>
      React.createElement('Defs', props, props.children),
    LinearGradient: (props: React.PropsWithChildren<unknown>) =>
      React.createElement('LinearGradient', props, props.children),
    Stop: (props: Record<string, unknown>) =>
      React.createElement('Stop', props),
    SvgXml: (props: Record<string, unknown>) =>
      React.createElement('SvgXml', props),
    SvgUri: (props: Record<string, unknown>) =>
      React.createElement('SvgUri', props),
  };
});

// Note: NativeAnimatedHelper mock is not needed on RN 0.79

// Mock @livekit/react-native
jest.mock('@livekit/react-native', () => {
  // Mock AudioSession
  const AudioSession = {
    configureAudio: jest.fn(),
    startAudioSession: jest.fn(),
    stopAudioSession: jest.fn(),
  };

  // Mock Room
  class MockRoom {
    localParticipant = {
      setMicrophoneEnabled: jest.fn(),
      setCameraEnabled: jest.fn(),
      isMicrophoneEnabled: false,
      isCameraEnabled: false,
    };
    participants = new Map();
    state = 'disconnected';
    connect = jest.fn();
    disconnect = jest.fn();
    addListener = jest.fn();
    removeListener = jest.fn();
    prepareConnection = jest.fn();
  }

  return {
    AudioSession,
    Room: MockRoom,
    useRoomContext: jest.fn(() => new MockRoom()),
    RoomContext: {
      Provider: ({children}: {children: React.ReactNode}) => children,
      Consumer: ({children}: {children: (room: MockRoom) => React.ReactNode}) =>
        children(new MockRoom()),
    },
    useParticipant: jest.fn(() => ({
      cameraPublication: null,
      microphonePublication: null,
      screenSharePublication: null,
      isLocal: false,
      isSpeaking: false,
    })),
    useToken: jest.fn(),
    isTrackReference: jest.fn(),
    isTrackReferencePlaceholder: jest.fn(),
    isTrackReferenceSubscribed: jest.fn(),
    AndroidAudioTypePresets: {
      media: {},
      communication: {},
    },
  };
});

// Mock react-native-config
jest.mock('react-native-config', () => {
  return {
    __esModule: true,
    default: {
      ENVIRONMENT: 'test',
      API_BASE_URL: 'https://test-api.example.com',
      API_VERSION: 'v1',
      ALLY_WEB_URL: 'https://test.example.com',
      MICROPHONE_SOCKET_PATH: '/test/socket',
      CLOUD_TELEPHONY_PATH: '/test/telephony',
      GOOGLE_WEB_CLIENT_ID: 'test-google-web-client-id',
      GOOGLE_IOS_CLIENT_ID: 'test-google-ios-client-id',
    },
  };
});

// Mock @invertase/react-native-apple-authentication (loads native code at import time)
jest.mock('@invertase/react-native-apple-authentication', () => {
  const React = require('react');
  const {Text} = require('react-native');
  const AppleButton = ({onPress}: {onPress: () => void}) =>
    React.createElement(Text, {onPress}, 'Continue with Apple');
  AppleButton.Style = {BLACK: 'BLACK', WHITE: 'WHITE'};
  AppleButton.Type = {CONTINUE: 'CONTINUE', SIGN_IN: 'SIGN_IN'};
  return {
    AppleButton,
    appleAuth: {performRequest: jest.fn()},
    AppleError: {
      CANCELED: '1001',
      FAILED: '1000',
      INVALID_RESPONSE: '1002',
      NOT_HANDLED: '1003',
      UNKNOWN: '1000',
    },
    AppleRequestOperation: {LOGIN: 1, REFRESH: 2, LOGOUT: 3},
    AppleRequestScope: {EMAIL: 0, FULL_NAME: 1},
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
      const processedStyles: Record<string, Record<string, unknown>> = {};
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

// Mock @/components
jest.mock('@react-native-firebase/crashlytics', () => ({
  __esModule: true,
  default: () => ({
    log: jest.fn(),
    recordError: jest.fn(),
  }),
}));

// Engagement-reminder push: keeps native FCM/Notifee registration out of the
// module-load path for any test that transitively imports pushNotificationService.
jest.mock('@react-native-firebase/messaging', () => ({
  __esModule: true,
  default: () => ({
    getToken: jest.fn().mockResolvedValue('mock-fcm-token'),
    deleteToken: jest.fn().mockResolvedValue(undefined),
    onTokenRefresh: jest.fn(() => jest.fn()),
    onMessage: jest.fn(() => jest.fn()),
  }),
}));

jest.mock('@notifee/react-native', () => ({
  __esModule: true,
  default: {
    createChannel: jest.fn().mockResolvedValue('reminders'),
    displayNotification: jest.fn().mockResolvedValue(undefined),
  },
  AndroidImportance: {HIGH: 4},
}));

jest.mock('@/components', () => {
  const React = require('react');
  return {
    ErrorBoundary: ({children}: {children: React.ReactNode}) => children,
    Button: jest.fn(({label, onPress, isDisabled}) =>
      React.createElement(
        'TouchableOpacity',
        {
          onPress,
          disabled: isDisabled,
          testID: 'primary-button',
        },
        React.createElement('Text', {}, label),
      ),
    ),
    EmptyState: jest.fn(
      ({title, description, icon: Icon, iconProps, containerStyle}) =>
        React.createElement(
          'View',
          {testID: 'empty-state', style: containerStyle},
          [
            Icon && React.createElement(Icon, {key: 'icon', ...iconProps}),
            title &&
              React.createElement(
                'Text',
                {key: 'title', testID: 'empty-state-title'},
                title,
              ),
            description &&
              React.createElement(
                'Text',
                {key: 'description', testID: 'empty-state-description'},
                description,
              ),
          ].filter(Boolean),
        ),
    ),
    IllustratedModal: jest.fn(({visible}) =>
      visible
        ? React.createElement('View', {testID: 'illustrated-modal'})
        : null,
    ),
  };
});

// Mock @/components/EmptyState/EmptyState
jest.mock('@/components/EmptyState/EmptyState', () => ({
  EmptyState: jest.fn(
    ({title, description, icon: Icon, iconProps, containerStyle}) => {
      const React = require('react');
      return React.createElement(
        'View',
        {testID: 'empty-state', style: containerStyle},
        [
          Icon && React.createElement(Icon, {key: 'icon', ...iconProps}),
          title &&
            React.createElement(
              'Text',
              {key: 'title', testID: 'empty-state-title'},
              title,
            ),
          description &&
            React.createElement(
              'Text',
              {key: 'description', testID: 'empty-state-description'},
              description,
            ),
        ].filter(Boolean),
      );
    },
  ),
}));

// Mock react-native-webview
jest.mock('react-native-webview', () => {
  const React = require('react');
  return {
    WebView: (props: Record<string, unknown>) =>
      React.createElement('WebView', props),
    default: (props: Record<string, unknown>) =>
      React.createElement('WebView', props),
  };
});

// Mock react-native-live-audio-stream
jest.mock('react-native-live-audio-stream', () => ({
  init: jest.fn(),
  start: jest.fn(),
  stop: jest.fn(),
  on: jest.fn(),
}));

// Mock @sayem314/react-native-keep-awake
jest.mock('@sayem314/react-native-keep-awake', () => ({
  activateKeepAwake: jest.fn(),
  deactivateKeepAwake: jest.fn(),
  useKeepAwake: jest.fn(),
}));

// Mock @react-native-community/netinfo
jest.mock('@react-native-community/netinfo', () => ({
  useNetInfo: jest.fn(() => ({
    isConnected: true,
  })),
  fetch: jest.fn(() =>
    Promise.resolve({
      isConnected: true,
    }),
  ),
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
}));

// Mock drawer navigation for useTabScreenHeader
jest.mock('@/hooks/useDrawerNavigation', () => ({
  useDrawerNavigation: jest.fn(() => ({
    openDrawer: jest.fn(),
    closeDrawer: jest.fn(),
    toggleDrawer: jest.fn(),
  })),
}));

// React's "not wrapped in act(...)" warning means a test let a state update land
// outside act() — a timer fired, a promise resolved — so the assertions after it
// ran against a tree React had not finished re-rendering. The suite still goes
// green, which is exactly why these pile up unnoticed and turn into flakes.
// Fail the test that produced one instead of printing it.
//
// The collected warnings are checked in an afterEach registered here, i.e. at the
// root of every suite, so it runs after the suite's own afterEach hooks — timers
// drained in a file-level teardown are covered too. A test that installs its own
// console.error mock opts itself out, which is the existing behaviour.
const actWarnings: string[] = [];
let consoleErrorBeforeActGuard: typeof console.error;

// React logs the warning with the component name as a separate `%s` argument,
// so the raw first argument alone would name no component at all.
const formatActWarning = (args: unknown[]): string => {
  const rest = args.slice(1);
  return String(args[0]).replace(/%s/g, () =>
    rest.length ? String(rest.shift()) : '%s',
  );
};

beforeEach(() => {
  actWarnings.length = 0;
  consoleErrorBeforeActGuard = console.error;
  console.error = (...args: Parameters<typeof console.error>) => {
    if (typeof args[0] === 'string' && args[0].includes('not wrapped in act')) {
      actWarnings.push(formatActWarning(args));
      return;
    }
    consoleErrorBeforeActGuard(...args);
  };
});

afterEach(() => {
  console.error = consoleErrorBeforeActGuard;
  if (actWarnings.length === 0) {
    jest.clearAllMocks();
    return;
  }
  const [first] = actWarnings;
  const count = actWarnings.length;
  actWarnings.length = 0;
  jest.clearAllMocks();
  throw new Error(
    `${count} React state update${count === 1 ? '' : 's'} in this test ` +
      `happened outside act(...). Wrap whatever triggers them — a ` +
      `fireEvent, a jest.advanceTimersByTime, a rerender — in act(...) so ` +
      `React flushes before the assertions run.\n\n${first}`,
  );
});
