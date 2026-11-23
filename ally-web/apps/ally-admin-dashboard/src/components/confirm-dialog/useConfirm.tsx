import { ReactNode, useCallback, useRef, useState } from "react";

import { ConfirmDialog, ConfirmDialogProps } from "./ConfirmDialog";

type ConfirmOptions = Pick<
  ConfirmDialogProps,
  "title" | "consequence" | "irreversible" | "confirmLabel" | "cancelLabel"
>;

/**
 * Promise-style replacement for `window.confirm`:
 *   const { confirm, dialog } = useConfirm();
 *   if (!(await confirm({...}))) return;
 *   ...render {dialog} once in the component.
 */
export const useConfirm = () => {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolverRef = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback(
    (opts: ConfirmOptions) =>
      new Promise<boolean>(resolve => {
        resolverRef.current?.(false);
        resolverRef.current = resolve;
        setOptions(opts);
      }),
    [],
  );

  const settle = (ok: boolean) => {
    resolverRef.current?.(ok);
    resolverRef.current = null;
    setOptions(null);
  };

  const dialog: ReactNode = options ? (
    <ConfirmDialog
      isOpen
      {...options}
      confirmLabel={options.confirmLabel}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  ) : null;

  return { confirm, dialog };
};
