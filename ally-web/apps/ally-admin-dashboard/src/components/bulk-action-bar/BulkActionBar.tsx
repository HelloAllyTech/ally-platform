import { FC, ReactNode } from "react";

import { Button } from "@components";
import { ButtonVariant } from "@components/types";
import { en } from "@constants/en";

export interface BulkAction {
  label: string;
  onClick: () => void;
  variant?: (typeof ButtonVariant)[keyof typeof ButtonVariant];
  disabled?: boolean;
}

/** Sticky bar shown while rows are selected. Renders nothing when `count` is 0. */
export const BulkActionBar: FC<{
  count: number;
  actions: BulkAction[];
  onClear: () => void;
  children?: ReactNode;
}> = ({ count, actions, onClear, children }) => {
  if (count <= 0) return null;
  return (
    <div
      role="toolbar"
      className="sticky bottom-2 z-10 flex flex-wrap items-center gap-3 rounded border border-border-light bg-white px-4 py-2 shadow-lg"
    >
      <span className="text-sm font-medium">{en.adminUx.bulk.selected(count)}</span>
      {actions.map(a => (
        <Button
          key={a.label}
          onClick={a.onClick}
          variant={a.variant ?? ButtonVariant.SECONDARY}
          disabled={a.disabled}
        >
          {a.label}
        </Button>
      ))}
      {children}
      <button type="button" onClick={onClear} className="ml-auto text-xs underline">
        {en.adminUx.bulk.clear}
      </button>
    </div>
  );
};
