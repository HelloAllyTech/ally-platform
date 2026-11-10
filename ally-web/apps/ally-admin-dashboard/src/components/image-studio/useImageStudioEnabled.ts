import { Context, createContext, useContext, useEffect, useState } from "react";

import { ReactReduxContext, ReactReduxContextValue } from "react-redux";

/**
 * Whether Generate should be offered at all (`GET /config` → `enabled`).
 *
 * Safe to call from any editor, including ones rendered without the app's
 * Redux store (isolated component tests): with no store it answers false and
 * loads nothing. The API slice is imported on demand, so editors that merely
 * host an image field don't pull Image Studio into their import graph.
 */

type StoreContext = Context<Pick<ReactReduxContextValue, "store"> | null>;
const NO_STORE: StoreContext = createContext<Pick<ReactReduxContextValue, "store"> | null>(null);
let storeContext: StoreContext | null = null;

/**
 * react-redux's context, read lazily: a test that mocks `react-redux` without
 * it must still be able to render an editor that hosts an image slot.
 */
const getStoreContext = (): StoreContext => {
  if (!storeContext) {
    try {
      storeContext = (ReactReduxContext as unknown as StoreContext | undefined) ?? NO_STORE;
    } catch {
      storeContext = NO_STORE;
    }
  }
  return storeContext;
};

let knownEnabled: boolean | null = null;
const listeners = new Set<(enabled: boolean) => void>();

const publish = (enabled: boolean) => {
  knownEnabled = enabled;
  listeners.forEach(listener => listener(enabled));
};

/** A 503 from a start: hide Generate everywhere until the page reloads. */
export const markImageStudioDisabled = () => publish(false);

export const useImageStudioEnabled = (): boolean => {
  const store = useContext(getStoreContext())?.store;
  const [enabled, setEnabled] = useState<boolean>(() => (store ? knownEnabled === true : false));

  useEffect(() => {
    listeners.add(setEnabled);
    return () => {
      listeners.delete(setEnabled);
    };
  }, []);

  useEffect(() => {
    if (!store) return undefined;
    let cancelled = false;
    let subscription: { unsubscribe: () => void } | undefined;
    import("@api/imageStudio")
      .then(({ imageStudioApi }) => {
        if (cancelled) return;
        // The store is typed for plain actions here; the thunk result is what we need.
        const dispatch = store.dispatch as unknown as (action: unknown) => {
          unwrap: () => Promise<{ enabled?: boolean }>;
          unsubscribe: () => void;
        };
        const request = dispatch(imageStudioApi.endpoints.getImageStudioConfig.initiate(undefined));
        subscription = request;
        request
          .unwrap()
          .then(config => {
            if (!cancelled) publish(config?.enabled === true);
          })
          .catch(() => {
            // 503 or unreachable: Image Studio is off for this session.
            if (!cancelled) publish(false);
          });
      })
      .catch(() => {
        if (!cancelled) setEnabled(false);
      });
    return () => {
      cancelled = true;
      subscription?.unsubscribe();
    };
  }, [store]);

  return Boolean(store) && enabled;
};
