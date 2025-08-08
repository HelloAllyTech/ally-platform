import '@testing-library/jest-native/extend-expect';

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
