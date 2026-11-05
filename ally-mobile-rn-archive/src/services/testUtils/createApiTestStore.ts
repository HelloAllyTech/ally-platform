import {afterEach} from '@jest/globals';
import {configureStore, type Reducer} from '@reduxjs/toolkit';

import {api} from '../api';

const buildApiTestStore = <T extends Record<string, Reducer>>(
  extraReducers: T,
) =>
  configureStore({
    reducer: {[api.reducerPath]: api.reducer, ...extraReducers},
    middleware: getDefaultMiddleware =>
      getDefaultMiddleware({
        immutableCheck: false,
        serializableCheck: false,
      }).concat(api.middleware),
    // `autoBatch` (on by default) defers subscriber notification to
    // requestAnimationFrame, which react-native's jest setup polyfills as
    // `setTimeout(() => callback(jest.now()), 0)`. A notification still queued when
    // the test ends calls `jest.now()` on a torn-down environment and throws
    // "You are trying to access a property or method of the Jest environment after
    // it has been torn down". Nothing here subscribes to the store, so batching
    // buys us nothing.
    enhancers: getDefaultEnhancers => getDefaultEnhancers({autoBatch: false}),
  });

// Untyped on the dispatched action so a store with any extra reducers can be tracked
// here regardless of its exact shape; the only thing ever dispatched to a tracked
// store is `api.util.resetApiState()`.
const liveStores: Array<{dispatch: (action: unknown) => unknown}> = [];

/**
 * Builds a throwaway store wired to the RTK Query `api` slice, with the two
 * background timers RTK Query would otherwise leave running after the test ends
 * disabled (see the `enhancers` note above) or cleaned up: unsubscribing from a
 * query schedules a `keepUnusedDataFor` cache-removal timer (60s by default), and
 * `api.util.resetApiState()` clears the pending ones.
 *
 * Importing this module registers the `afterEach` that resets every store it handed
 * out, so callers only need to use this in place of their own `configureStore` call.
 * Pass `extraReducers` for a test that also needs a non-`api` slice (e.g. one an
 * endpoint's `onQueryStarted` dispatches into).
 */
export function createApiTestStore<T extends Record<string, Reducer> = {}>(
  extraReducers?: T,
) {
  const store = buildApiTestStore(extraReducers ?? ({} as T));
  liveStores.push(store);
  return store;
}

afterEach(() => {
  while (liveStores.length > 0) {
    liveStores.pop()?.dispatch(api.util.resetApiState());
  }
});
