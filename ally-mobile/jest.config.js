module.exports = {
  preset: 'react-native',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  collectCoverageFrom: [
    '<rootDir>/src/**/*.{ts,tsx}',
    '!<rootDir>/src/**/__tests__/**',
    '!<rootDir>/src/**/*.d.ts',
    '!<rootDir>/src/**/index.ts',
    '!<rootDir>/src/**/index.tsx',
    // Exclude pure type definitions
    '!<rootDir>/src/types/**',
  ],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '\\.(svg)$': '<rootDir>/__mocks__/svgMock.js',
    '\\.(jpg|jpeg|png|gif|eot|otf|webp|ttf|woff|woff2|mp3|mp4|wav)$':
      '<rootDir>/__mocks__/fileMock.js',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(@react-native|react-native|react-native-.*|@react-navigation|@react-native-.*|@react-native-community|react-native-size-matters|@react-native/assets|@react-native/polyfills|react-native-svg|react-redux|@sayem314/react-native-keep-awake|react-native-webview)/)',
  ],
  collectCoverage: true,
  coverageReporters: ['html'],
  coverageDirectory: '<rootDir>/coverage',
  testTimeout: 300000,
};
