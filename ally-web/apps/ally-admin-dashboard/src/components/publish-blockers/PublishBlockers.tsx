import { FC } from "react";

import { en } from "@constants/en";

export interface PublishBlocker {
  id: string;
  /** Plain-language reason, e.g. "Add at least one scenario". */
  message: string;
  /** Optional jump to where it is fixed. */
  onFix?: () => void;
}

/** "What is blocking publish": a checklist instead of a silently disabled Publish button. */
export const PublishBlockers: FC<{
  blockers: PublishBlocker[];
  className?: string;
  /** One line instead of a box: the reasons inline, each with its Fix. */
  compact?: boolean;
}> = ({ blockers, className = "", compact = false }) => {
  const copy = en.adminUx.blockers;
  if (blockers.length === 0) {
    return (
      <p role="status" className={`text-sm text-green-700 ${className}`}>
        ✓ {copy.readyTitle}
      </p>
    );
  }
  if (compact) {
    return (
      <p
        role="status"
        className={`flex flex-wrap items-center gap-x-2 gap-y-1 rounded border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-typography-800 ${className}`}
      >
        <span className="font-medium">{copy.blockedTitle(blockers.length)}:</span>
        {blockers.map((b, index) => (
          <span key={b.id} className="inline-flex items-center gap-1">
            {b.message}
            {b.onFix && (
              <button type="button" onClick={b.onFix} className="underline">
                {copy.fix}
              </button>
            )}
            {index < blockers.length - 1 && <span className="text-typography-400">·</span>}
          </span>
        ))}
      </p>
    );
  }
  return (
    <div role="status" className={`rounded border border-amber-300 bg-amber-50 p-3 ${className}`}>
      <p className="text-sm font-medium">{copy.blockedTitle(blockers.length)}</p>
      <ul className="mt-1 list-disc pl-5 text-sm">
        {blockers.map(b => (
          <li key={b.id}>
            {b.message}
            {b.onFix && (
              <button type="button" onClick={b.onFix} className="ml-2 underline">
                {copy.fix}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
};
