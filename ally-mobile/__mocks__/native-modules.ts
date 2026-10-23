// Mock FileReader module
jest.mock('react-native/Libraries/Blob/FileReader', () => ({
  FileReader: jest.fn(),
}));

// Mock network logger
jest.mock('react-native-network-logger', () => ({
  startNetworkLogging: jest.fn(),
  stopNetworkLogging: jest.fn(),
  default: jest.fn(),
}));

// Mock TurboModuleRegistry
jest.mock('react-native/Libraries/TurboModule/TurboModuleRegistry', () => ({
  getEnforcing: () => ({
    readAsDataURL: jest.fn(),
    readAsText: jest.fn(),
  }),
}));
