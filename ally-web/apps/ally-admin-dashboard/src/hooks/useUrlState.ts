import { useCallback, useMemo } from "react";

import { useSearchParams } from "react-router-dom";

/**
 * Keep a string filter in the URL (?key=value) so a refresh, back-button or shared link keeps
 * the view. Empty / default values are removed from the URL. Uses replace so typing a search
 * does not fill the history stack.
 */
export const useUrlState = (key: string, defaultValue = ""): [string, (v: string) => void] => {
  const [params, setParams] = useSearchParams();
  const value = params.get(key) ?? defaultValue;
  const setValue = useCallback(
    (next: string) => {
      setParams(
        prev => {
          const copy = new URLSearchParams(prev);
          if (next === "" || next === defaultValue) copy.delete(key);
          else copy.set(key, next);
          return copy;
        },
        { replace: true },
      );
    },
    [key, defaultValue, setParams],
  );
  return [value, setValue];
};

/** Several keys at once, as one object. */
export const useUrlStates = <K extends string>(defaults: Record<K, string>) => {
  const [params, setParams] = useSearchParams();
  const values = useMemo(() => {
    const out = {} as Record<K, string>;
    (Object.keys(defaults) as K[]).forEach(k => {
      out[k] = params.get(k) ?? defaults[k];
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);
  const setValues = useCallback(
    (patch: Partial<Record<K, string>>) => {
      setParams(
        prev => {
          const copy = new URLSearchParams(prev);
          (Object.keys(patch) as K[]).forEach(k => {
            const v = patch[k] ?? "";
            if (v === "" || v === defaults[k]) copy.delete(k);
            else copy.set(k, v);
          });
          return copy;
        },
        { replace: true },
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setParams],
  );
  return [values, setValues] as const;
};
