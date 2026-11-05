/**
 * Framework-agnostic imperative bridge to the mounted `<Toast>`.
 *
 * Deliberately has NO imports beyond plain types. `src/services/api.ts` —
 * the root module every RTK Query API slice is built on — calls `showToast`
 * directly on a forced logout (session expiry), and anything heavier
 * imported here (e.g. `@/hooks`, `@/utils/error`, or the `@/components`
 * barrel, all of which `ToastProvider.tsx` itself pulls in) would create a
 * circular import back through `@/services` to `api.ts`: those modules
 * transitively import components/hooks that call RTK Query hooks, which
 * import `./api`. That cycle can leave `api` undefined when a service
 * module evaluates before `api.ts` finishes exporting it.
 *
 * `ToastProvider` registers its real `showToast`/`hideToast` implementation
 * here on mount; callers anywhere in the app (including `api.ts`) invoke the
 * functions below without needing to know whether a provider is mounted yet.
 */
export type ToastType = 'success' | 'error';
export type ToastPosition = 'top' | 'bottom';

export interface ShowToastOptions {
  message: string;
  type?: ToastType;
  duration?: number;
  position?: ToastPosition;
  onHide?: () => void;
}

type ShowToastHandler = (
  options: ShowToastOptions | string,
  type?: ToastType,
) => void;
type HideToastHandler = () => void;

let showHandler: ShowToastHandler | null = null;
let hideHandler: HideToastHandler | null = null;

/** Called by `ToastProvider` to wire up the real implementation on mount. */
export const registerToastHandlers = (
  show: ShowToastHandler,
  hide: HideToastHandler,
): void => {
  showHandler = show;
  hideHandler = hide;
};

/**
 * Show a toast from anywhere — component, hook, or plain module. A no-op if
 * no `ToastProvider` has mounted yet (e.g. called before the app tree is
 * ready), rather than throwing.
 */
export const showToast = (
  options: ShowToastOptions | string,
  type?: ToastType,
): void => {
  showHandler?.(options, type);
};

export const hideToast = (): void => {
  hideHandler?.();
};
