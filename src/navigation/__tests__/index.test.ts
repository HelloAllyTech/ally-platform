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

describe('navigation index exports', () => {
  it('exports navigators and types re-exports', () => {
    expect(typeof nav).toBe('object');
    // Just assert the named exports exist
    expect(nav).toHaveProperty('RootNavigator');
    expect(nav).toHaveProperty('DrawerNavigator');
    expect(nav).toHaveProperty('TabNavigator');
  });
});


