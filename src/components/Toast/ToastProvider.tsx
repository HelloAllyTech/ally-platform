import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';

import {Toast} from './Toast';

export type ToastType = 'success' | 'error' | 'info';
export type ToastPosition = 'top' | 'bottom';

export interface ShowToastOptions {
  message: string;
  type?: ToastType;
  duration?: number;
  position?: ToastPosition;
  onHide?: () => void;
}

interface ToastContextValue {
  showToast: (options: ShowToastOptions | string, type?: ToastType) => void;
  hideToast: () => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

interface ToastState {
  visible: boolean;
  message: string;
  type: ToastType;
  duration: number;
  position: ToastPosition;
  onHide?: () => void;
}

let externalShowRef:
  | ((options: ShowToastOptions | string, type?: ToastType) => void)
  | null = null;
let externalHideRef: (() => void) | null = null;

export const ToastProvider: React.FC<React.PropsWithChildren> = ({
  children,
}) => {
  const onHideCallbackRef = useRef<(() => void) | undefined>(undefined);
  const [toastState, setToastState] = useState<ToastState | null>(null);

  const showToast = useCallback(
    (options: ShowToastOptions | string, fallbackType?: ToastType) => {
      const finalOptions: ShowToastOptions =
        typeof options === 'string'
          ? {message: options, type: fallbackType}
          : options;

      setToastState({
        visible: true,
        message: finalOptions.message,
        type: finalOptions.type || 'info',
        duration: finalOptions.duration ?? 3000,
        position: finalOptions.position || 'bottom',
        onHide: finalOptions.onHide,
      });

      onHideCallbackRef.current = finalOptions.onHide;
    },
    [],
  );

  const hideToast = useCallback(() => {
    setToastState(prev => (prev ? {...prev, visible: false} : prev));
  }, []);

  // Expose imperative API
  externalShowRef = showToast;
  externalHideRef = hideToast;

  const value = useMemo<ToastContextValue>(
    () => ({showToast, hideToast}),
    [showToast, hideToast],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toastState?.visible && (
        <Toast
          message={toastState.message}
          type={toastState.type}
          duration={toastState.duration}
          position={toastState.position}
          onHide={() => {
            setToastState(null);
            onHideCallbackRef.current?.();
            onHideCallbackRef.current = undefined;
          }}
        />
      )}
    </ToastContext.Provider>
  );
};

export const useToast = (): ToastContextValue => {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return ctx;
};

export const showToast = (
  options: ShowToastOptions | string,
  type?: ToastType,
) => {
  externalShowRef?.(options, type);
};

export const hideToast = () => {
  externalHideRef?.();
};
