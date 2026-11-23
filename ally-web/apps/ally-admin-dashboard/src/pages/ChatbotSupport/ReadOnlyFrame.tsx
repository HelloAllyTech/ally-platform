import React, { useEffect, useRef } from "react";

import { STAFF_SUPPORT_COPY } from "./copy";

const c = STAFF_SUPPORT_COPY.banner;

/**
 * Form controls the frame turns off: everything you type into or choose from. A control marked
 * `data-read-only-keep` only filters what is shown (the inbox's channel filter) and stays usable.
 */
export const READ_ONLY_KEEP = "data-read-only-keep";
const EDITABLE = ["input", "textarea", "select", "[contenteditable='true']"]
  .map(selector => `${selector}:not([${READ_ONLY_KEEP}])`)
  .join(", ");

/** Turn off every input, text area and choice inside `root` (they keep their values). */
export const disableEditable = (root: ParentNode): number => {
  let changed = 0;
  root.querySelectorAll<HTMLElement>(EDITABLE).forEach(element => {
    if (element.isContentEditable) {
      element.setAttribute("contenteditable", "false");
      changed += 1;
      return;
    }
    const control = element as HTMLInputElement;
    if (!control.disabled) {
      control.disabled = true;
      control.setAttribute("aria-readonly", "true");
      changed += 1;
    }
  });
  return changed;
};

/**
 * Assistants stage 8: the chatbot home in a read-only staff frame. A banner says the view is
 * logged, and every input inside is disabled, including ones that appear later (a mutation
 * observer). Section navigation stays usable. The server is what enforces read-only: staff get
 * view on setup routes and nothing else, so this frame is for clarity, not security.
 */
export const ReadOnlyFrame: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return undefined;
    disableEditable(root);
    if (typeof MutationObserver === "undefined") return undefined;
    const observer = new MutationObserver(() => disableEditable(root));
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["disabled", "contenteditable"],
    });
    return () => observer.disconnect();
  }, []);
  return (
    <div className="ally-v2" data-testid="staff-read-only">
      <div
        role="status"
        className="ally-card"
        data-testid="staff-read-only-banner"
        style={{ margin: "12px 16px", padding: "12px 16px" }}
      >
        <strong>{c.title}</strong>
        <p className="ally-small" style={{ margin: "4px 0 0" }}>
          {c.body}
        </p>
      </div>
      <div ref={ref}>{children}</div>
    </div>
  );
};
