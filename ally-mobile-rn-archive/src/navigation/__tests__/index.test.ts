jest.mock('@notifee/react-native', () => ({
  __esModule: true,
  default: {
    createChannel: jest.fn(),
    requestPermission: jest.fn(),
    createTriggerNotification: jest.fn(),
    cancelTriggerNotification: jest.fn(),
    onForegroundEvent: jest.fn(() => jest.fn()),
    onBackgroundEvent: jest.fn(),
    getInitialNotification: jest.fn(() => Promise.resolve(null)),
  },
  AndroidImportance: {HIGH: 4},
  EventType: {PRESS: 1, DISMISSED: 2},
  TriggerType: {TIMESTAMP: 0},
  RepeatFrequency: {WEEKLY: 2},
}));

jest.mock('@/config/env', () => ({
  env: {
    NOTIFICATION_SCHEDULE_DAY: 1,
    NOTIFICATION_SCHEDULE_HOUR: 11,
    NOTIFICATION_SCHEDULE_MINUTE: 0,
  },
}));

// Avoid importing modules that pull native modules via hooks index
jest.mock('@/hooks', () => ({
  useAppNavigation: () => ({navigate: jest.fn(), reset: jest.fn()}),
}));

// Stub components that import native network logger transitively
jest.mock('@/components', () => ({
  NetworkLogs: () => null,
}));

// Stub screens barrel to avoid heavy imports
jest.mock('@/screens', () => ({}));

// Mock react-navigation navigators to avoid requiring native modules
jest.mock('@react-navigation/drawer', () => ({
  createDrawerNavigator: () => ({Navigator: ({children}: any) => children, Screen: () => null}),
}));
jest.mock('@react-navigation/native-stack', () => ({
  createNativeStackNavigator: () => ({Navigator: ({children}: any) => children, Screen: () => null}),
}));
jest.mock('@react-navigation/bottom-tabs', () => ({
  createBottomTabNavigator: () => ({Navigator: ({children}: any) => children, Screen: () => null}),
}));

// Mock TabNavigator/DrawerNavigator to be inert
jest.mock('../TabNavigator', () => ({
  BottomTabs: () => null,
}));
jest.mock('../DrawerNavigator', () => ({
  DrawerNavigator: () => null,
}));

import * as nav from '../index';

// Mock RTK Query api and store to avoid reducerPath undefined due to slice wiring
jest.mock('@/services/api', () => {
  const api = {
    reducerPath: 'api',
    reducer: jest.fn(),
    middleware: jest.fn(),
    injectEndpoints: jest.fn().mockReturnValue({
      useGetSummaryFieldsQuery: () => ({data: ['field1'], isLoading: false}),
    }),
  } as any;
  return {api};
});
jest.mock('@/store/store', () => ({
  store: {dispatch: jest.fn(), getState: jest.fn()},
}));

describe('navigation index exports', () => {
  it('exports navigators and types re-exports', () => {
    expect(typeof nav).toBe('object');
    // Just assert the named exports exist
    expect(nav).toHaveProperty('RootNavigator');
    expect(nav).toHaveProperty('DrawerNavigator');
    expect(nav).toHaveProperty('TabNavigator');
  });
});


