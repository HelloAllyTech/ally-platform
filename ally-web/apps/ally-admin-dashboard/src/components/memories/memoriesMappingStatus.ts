import { useSyncExternalStore } from "react";

/**
 * "Memories are being mapped" flag, shared between the component that starts
 * the mapping (beside the prompt picker) and the Memories editor further down
 * the form. Kept out of the form values on purpose: every form key is sent on
 * save, and a transient UI flag has no business in a scenario payload.
 *
 * Keyed by the form's `control` object so two forms on screen never share it.
 */
const inFlight = new WeakSet<object>();
const listeners = new Set<() => void>();

export const setMemoriesMapping = (formKey: object, mapping: boolean): void => {
  if (mapping) inFlight.add(formKey);
  else inFlight.delete(formKey);
  listeners.forEach(listener => listener());
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const useIsMappingMemories = (formKey: object | undefined): boolean =>
  useSyncExternalStore(subscribe, () => (formKey ? inFlight.has(formKey) : false));
