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
export const PublishBlockers: FC<{ blockers: PublishBlocker[]; className?: string }> = ({
  blockers,
  className = "",
}) => {
  const copy = en.adminUx.blockers;
  if (blockers.length === 0) {
    return (
      <p role="status" className={`text-sm text-green-700 ${className}`}>
        ✓ {copy.readyTitle}
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
