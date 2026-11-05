import reducer, {
  clearUser,
  handleLogout,
  setAuthenticated,
  setLoading,
  setPermissions,
  setUser,
  storeTokens,
} from '@/store/slices/userSlice';
import {AsyncStorageKeys} from '@/constants';
import {User, UserRole} from '@/types';

jest.mock('@/utils/asyncStorage', () => ({
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

const {setItem, removeItem} = jest.requireMock('@/utils/asyncStorage');

describe('userSlice reducers', () => {
  it('should return initial state', () => {
    const state = reducer(undefined, {type: 'unknown'} as any);
    expect(state.isAuthenticated).toBe(false);
    expect(state.user).toBeNull();
    expect(state.loading).toBe(true);
    expect(state.permissions).toEqual([]);
  });

  it('setAuthenticated should toggle auth flag', () => {
    const next = reducer(undefined, setAuthenticated(true));
    expect(next.isAuthenticated).toBe(true);
  });

  it('setLoading should set loading flag', () => {
    const next = reducer(undefined, setLoading(false));
    expect(next.loading).toBe(false);
  });

  it('setUser should set user and clearUser should nullify it', () => {
    const mockUser: User = {
      email: 'user@example.com',
      id: 1,
      name: 'Test User',
      phone: '1234567890',
      role: UserRole.CLIENT,
      userId: 1,
    };
    const withUser = reducer(undefined, setUser(mockUser));
    expect(withUser.user).toEqual(mockUser);

    const cleared = reducer(withUser, clearUser());
    expect(cleared.user).toBeNull();
  });

  it('setPermissions should set permissions array', () => {
    const next = reducer(undefined, setPermissions(['read', 'write']));
    expect(next.permissions).toEqual(['read', 'write']);
  });
});

describe('userSlice thunks', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('storeTokens should persist access and refresh tokens', async () => {
    const dispatch = jest.fn();
    const getState = jest.fn();

    await storeTokens({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
    })(dispatch, getState, undefined);

    expect(setItem).toHaveBeenCalledWith(
      AsyncStorageKeys.ACCESS_TOKEN,
      'access-token',
    );
    expect(setItem).toHaveBeenCalledWith(
      AsyncStorageKeys.REFRESH_TOKEN,
      'refresh-token',
    );
  });

  it('handleLogout should clear tokens and dispatch reset actions', async () => {
    const dispatch = jest.fn();
    const getState = jest.fn();

    await handleLogout()(dispatch, getState, undefined);

    expect(removeItem).toHaveBeenCalledWith(AsyncStorageKeys.ACCESS_TOKEN);
    expect(removeItem).toHaveBeenCalledWith(AsyncStorageKeys.REFRESH_TOKEN);

    expect(dispatch).toHaveBeenCalledWith(setAuthenticated(false));
    expect(dispatch).toHaveBeenCalledWith(clearUser());
    expect(dispatch).toHaveBeenCalledWith(setPermissions([]));
  });
});


