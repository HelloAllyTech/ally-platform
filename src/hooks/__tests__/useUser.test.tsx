import React from 'react';
import {Text} from 'react-native';
import {render, act} from '@testing-library/react-native';

import {useUser} from '../useUser';

jest.mock('@/store/store', () => ({ store: { dispatch: jest.fn() } }));
jest.mock('@/store/slices/userSlice', () => ({
  handleLogout: () => ({ type: 'logout' }),
  setAuthenticated: (v: boolean) => ({ type: 'setAuth', payload: v }),
  setLoading: (v: boolean) => ({ type: 'setLoading', payload: v }),
  setPermissions: (p: any[]) => ({ type: 'setPerms', payload: p }),
  setUser: (u: any) => ({ type: 'setUser', payload: u }),
}));

let mockAccessToken: string | undefined = 'a';
let mockRefreshToken: string | undefined = 'r';
jest.mock('@/utils/asyncStorage', () => ({
  getItem: jest.fn(async (k: string) => (k.includes('ACCESS_TOKEN') ? mockAccessToken : mockRefreshToken)),
}));

const mockGetUser = jest.fn(async () => ({ data: { id: 1 } }));
const mockGetPerms = jest.fn(async () => ({ data: ['A'] }));
jest.mock('@/services/authApi', () => ({
  useLazyGetUserQuery: () => [mockGetUser],
  useLazyGetPermissionsQuery: () => [mockGetPerms],
}));

jest.mock('react-redux', () => ({
  useSelector: (sel: any) => sel({user: {isAuthenticated: false, user: null, loading: false}}),
  useDispatch: () => jest.fn(),
  useStore: () => ({
    getState: jest.fn(() => ({user: {isAuthenticated: false, user: null, loading: false}})),
    dispatch: jest.fn(),
  }),
}));

jest.mock('@/utils/logger', () => ({ logger: { error: jest.fn() } }));

describe('useUser', () => {
  const Test = () => {
    const {checkAuth, isAuthenticated, userData, isUserLoading, handleUserLogout} = useUser();
    return (
      <>
        <Text testID="check" onPress={checkAuth} />
        <Text testID="logout" onPress={handleUserLogout} />
        <Text testID="auth">{String(isAuthenticated)}</Text>
        <Text testID="user">{String(!!userData)}</Text>
        <Text testID="loading">{String(isUserLoading)}</Text>
      </>
    );
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockAccessToken = 'a';
    mockRefreshToken = 'r';
    mockGetUser.mockResolvedValue({ data: { id: 1 } });
    mockGetPerms.mockResolvedValue({ data: ['A'] });
  });

  it('auth success path dispatches user and permissions', async () => {
    const {getByTestId} = render(<Test />);
    await act(async () => { await getByTestId('check').props.onPress(); });
    const { store } = require('@/store/store');
    expect(store.dispatch).toHaveBeenCalledWith({ type: 'setUser', payload: { id: 1 } });
    expect(store.dispatch).toHaveBeenCalledWith({ type: 'setPerms', payload: ['A'] });
    expect(store.dispatch).toHaveBeenCalledWith({ type: 'setAuth', payload: true });
    expect(store.dispatch).toHaveBeenCalledWith({ type: 'setLoading', payload: false });
  });

  it('no token triggers logout', async () => {
    mockAccessToken = undefined;
    mockRefreshToken = undefined;
    const {getByTestId} = render(<Test />);
    await act(async () => { await getByTestId('check').props.onPress(); });
    const { store } = require('@/store/store');
    expect(store.dispatch).toHaveBeenCalledWith({ type: 'logout' });
    expect(store.dispatch).toHaveBeenCalledWith({ type: 'setLoading', payload: false });
  });

  it('error during check triggers logout and logs', async () => {
    const { logger } = require('@/utils/logger');
    mockGetUser.mockRejectedValueOnce(new Error('boom'));
    const {getByTestId} = render(<Test />);
    await act(async () => { await getByTestId('check').props.onPress(); });
    const { store } = require('@/store/store');
    expect(store.dispatch).toHaveBeenCalledWith({ type: 'logout' });
    expect(logger.error).toHaveBeenCalled();
    expect(store.dispatch).toHaveBeenCalledWith({ type: 'setLoading', payload: false });
  });
});
