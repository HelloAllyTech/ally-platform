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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  RN.TouchableOpacity = (props: any) =>
    React.createElement('TouchableOpacity', props, props.children);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  RN.View = (props: any) => React.createElement('View', props, props.children);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  RN.Text = ({children, ...props}: any) =>
    React.createElement('Text', props, children);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  RN.Image = (props: any) => React.createElement('Image', props);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  RN.ActivityIndicator = ({...props}: any) =>
    React.createElement('ActivityIndicator', props);

  return RN;
});

// Silence react-native-reanimated warnings in tests
jest.mock('react-native-reanimated', () =>
  require('react-native-reanimated/mock'),
);

// Mock react-native-svg
/* eslint-disable @typescript-eslint/no-explicit-any */
jest.mock('react-native-svg', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: (props: any) => React.createElement('Svg', props, props.children),
    Svg: (props: any) => React.createElement('Svg', props, props.children),
    Circle: (props: any) => React.createElement('Circle', props),
    Rect: (props: any) => React.createElement('Rect', props),
    Path: (props: any) => React.createElement('Path', props),
    Line: (props: any) => React.createElement('Line', props),
    G: (props: any) => React.createElement('G', props, props.children),
    Text: (props: any) => React.createElement('SvgText', props, props.children),
    Defs: (props: any) => React.createElement('Defs', props, props.children),
    LinearGradient: (props: any) =>
      React.createElement('LinearGradient', props, props.children),
    Stop: (props: any) => React.createElement('Stop', props),
    SvgXml: (props: any) => React.createElement('SvgXml', props),
    SvgUri: (props: any) => React.createElement('SvgUri', props),
  };
});
/* eslint-enable @typescript-eslint/no-explicit-any */

// Note: NativeAnimatedHelper mock is not needed on RN 0.79

// Mock @livekit/react-native
jest.mock('@livekit/react-native', () => {
  const React = require('react');

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
      Consumer: ({children}: {children: (room: any) => React.ReactNode}) =>
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
      POST_SIMULATION_NEW_TABS_FLAG: 'true',
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
jest.mock('@/components', () => {
  const React = require('react');
  return {
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
    WebView: (props: any) => React.createElement('WebView', props),
    default: (props: any) => React.createElement('WebView', props),
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
