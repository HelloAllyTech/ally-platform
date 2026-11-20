import { FC, ReactNode } from "react";

interface BlockProps {
  /** Block name, for example "Quote slider". */
  label: string;
  enabled: boolean;
  editable: boolean;
  onToggle: (next: boolean) => void;
  className?: string;
  children: ReactNode;
}

/**
 * Wraps a page block with a show/hide switch while editing. A hidden block
 * stays on screen, dimmed and labelled, so it can be switched back on; as a
 * visitor sees the page it is simply absent.
 */
export const Block: FC<BlockProps> = ({
  label,
  enabled,
  editable,
  onToggle,
  className,
  children,
}) => {
  if (!editable) return enabled ? <div className={className}>{children}</div> : null;

  return (
    <div className={`lp-block ${enabled ? "" : "is-hidden"} ${className ?? ""}`.trim()}>
      <button
        type="button"
        className="lp-block-toggle"
        aria-pressed={enabled}
        aria-label={`${enabled ? "Hide" : "Show"} ${label}`}
        onClick={() => onToggle(!enabled)}
      >
        {enabled ? `Hide ${label}` : `Show ${label}`}
      </button>
      {!enabled && (
        <p className="lp-block-note">{label} is hidden and will not appear on the page.</p>
      )}
      <div className="lp-block-body">{children}</div>
    </div>
  );
};
