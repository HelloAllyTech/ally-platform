import { FC, ReactNode, useId, useState } from "react";

import { ArrowDown } from "@icons";

/**
 * One collapsed section of the bug drawer: a full-width header that opens and
 * closes it, closed by default.
 *
 * Closed on purpose. Everything that goes in one of these is the audit trail —
 * how sure Bug Hunter was, how it planned the fix, how it decided, what it did
 * — which a reader needs when a decision looks wrong, not every time the drawer
 * opens. The drawer leads with the decision instead, and keeps the rest one
 * click away (Stacks: *Progressive Disclosure and Contextual Relevance in Agent
 * Interfaces*).
 *
 * The body is not rendered until it is opened, so a closed section costs
 * nothing and its contents stay out of the tab order.
 */
export const DrawerSection: FC<{
  title: string;
  /** A short fact shown beside the title while closed — a score, a count. */
  hint?: string | null;
  testId?: string;
  children: ReactNode;
}> = ({ title, hint, testId, children }) => {
  const [open, setOpen] = useState(false);
  const bodyId = useId();

  return (
    <section data-testid={testId} className="border-t border-border-light">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen(isOpen => !isOpen)}
        className="flex w-full cursor-pointer items-center justify-between gap-3 py-3 text-left"
      >
        <span className="text-sm font-semibold text-typography-900">{title}</span>
        <span className="flex items-center gap-2 text-xs text-typography-500 tabular-nums">
          {hint}
          <ArrowDown
            aria-hidden="true"
            className={`transition-transform ${open ? "rotate-180" : ""}`}
          />
        </span>
      </button>
      {open && (
        <div id={bodyId} className="flex flex-col gap-3 pb-4">
          {children}
        </div>
      )}
    </section>
  );
};
