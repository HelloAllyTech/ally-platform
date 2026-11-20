import { RefObject, useEffect } from "react";

/** A card shows this many fields before "More" (§4.17). */
export const STACKED_VISIBLE_FIELDS = 3;

/**
 * Label every cell of every table under `root` with its column's header text, and mark rows that
 * have more than the visible fields, so the phone stylesheet (`.roadmap-stacked-tables` in
 * styles.css) can lay the table out as stacked cards. Re-runs when the tables change.
 */
export const labelTables = (root: HTMLElement, moreLabel: string): void => {
  root.querySelectorAll("table").forEach(table => {
    const headers = Array.from(table.querySelectorAll("thead th")).map(
      th => th.textContent?.trim() ?? "",
    );
    table.querySelectorAll("tbody tr").forEach(row => {
      const cells = Array.from(row.children) as HTMLElement[];
      cells.forEach((cell, index) => {
        const label = headers[index] ?? "";
        if (cell.getAttribute("data-label") !== label) cell.setAttribute("data-label", label);
      });
      const more = cells.length > STACKED_VISIBLE_FIELDS;
      if (more) {
        row.setAttribute("data-more", "true");
        if (row.getAttribute("data-more-label") !== moreLabel) {
          row.setAttribute("data-more-label", moreLabel);
        }
        if (!row.hasAttribute("tabindex")) row.setAttribute("tabindex", "0");
        row.setAttribute("aria-expanded", row.getAttribute("data-expanded") ?? "false");
      }
    });
  });
};

/** Toggle a row's hidden fields. Clicks on a link or button inside the row keep their own job. */
export const toggleRowFor = (target: EventTarget | null, moreLabel: string, lessLabel: string) => {
  const element = target as HTMLElement | null;
  if (!element?.closest) return false;
  if (element.closest("a, button, input, select, textarea, [role='button']")) return false;
  const row = element.closest("tbody tr[data-more='true']") as HTMLElement | null;
  if (!row) return false;
  const expanded = row.getAttribute("data-expanded") === "true";
  row.setAttribute("data-expanded", expanded ? "false" : "true");
  row.setAttribute("aria-expanded", expanded ? "false" : "true");
  row.setAttribute("data-more-label", expanded ? moreLabel : lessLabel);
  return true;
};

export const useStackedTables = (
  ref: RefObject<HTMLElement>,
  enabled: boolean,
  labels: { more: string; less: string },
): void => {
  useEffect(() => {
    const root = ref.current;
    if (!enabled || !root) return undefined;
    let frame = 0;
    const relabel = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => labelTables(root, labels.more));
    };
    labelTables(root, labels.more);
    const observer = typeof MutationObserver !== "undefined" ? new MutationObserver(relabel) : null;
    observer?.observe(root, { childList: true, subtree: true });
    const onClick = (event: MouseEvent) => toggleRowFor(event.target, labels.more, labels.less);
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const target = event.target as HTMLElement;
      if (target?.matches?.("tbody tr[data-more='true']")) {
        event.preventDefault();
        toggleRowFor(target.firstElementChild ?? target, labels.more, labels.less);
      }
    };
    root.addEventListener("click", onClick);
    root.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      root.removeEventListener("click", onClick);
      root.removeEventListener("keydown", onKey);
    };
  }, [ref, enabled, labels.more, labels.less]);
};
