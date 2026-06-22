import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';

import {useTranslate} from '@/hooks';
import {TranslationType} from '@/localization/locales/type';
import {getErrorDetails} from '@/utils/error';

import {Toast} from './Toast';

export type ToastType = 'success' | 'error';
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
    (
      options: ShowToastOptions | string,
      fallbackType: ToastType = 'success',
    ) => {
      const finalOptions: ShowToastOptions =
        typeof options === 'string'
          ? {message: options, type: fallbackType}
          : options;

      setToastState({
        visible: true,
        message: finalOptions.message,
        type: finalOptions.type ?? fallbackType,
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
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
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

export const useErrorToast = () => {
  const {t} = useTranslate();

  const showErrorToast = useCallback(
    (error: unknown, fallbackKey: string) => {
      const errorDetails = getErrorDetails(error);
      const fallbackMessage = t(fallbackKey as TranslationType);

      const apiError = error as {data?: {message?: string; error?: string}};
      const hasApiError = apiError?.data?.message || apiError?.data?.error;

      const defaultFallback = t('postCallSummary.somethingWentWrongRetry');
      const hasSpecificError =
        hasApiError ||
        (errorDetails.message &&
          errorDetails.message !== defaultFallback &&
          errorDetails.message.trim() !== '');

      let message: string;
      if (hasSpecificError) {
        // Format as "Failed to start simulation: {reason}"
        message = `${fallbackMessage}: ${errorDetails.message}`;
      } else if (error instanceof Error && error.message?.trim()) {
        // Handle standard Error instances
        message = error.message;
      } else {
        // Use fallback translation
        message = fallbackMessage;
      }

      showToast(message, 'error');
    },
    [t],
  );

  return {showErrorToast};
};
