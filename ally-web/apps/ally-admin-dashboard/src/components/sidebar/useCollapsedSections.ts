import { useCallback, useState } from "react";

const STORAGE_KEY = "admin_sidebar_collapsed_sections";

const read = (): Set<string> => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return new Set(
      Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [],
    );
  } catch {
    return new Set();
  }
};

/**
 * Which sidebar sections the admin folded away. Kept in this browser's localStorage (a per-viewer
 * convenience, not an account preference); every section starts open.
 */
export const useCollapsedSections = () => {
  const [collapsed, setCollapsed] = useState<Set<string>>(read);

  const toggle = useCallback((id: string) => {
    setCollapsed(previous => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
      } catch {
        // Storage blocked: the fold lasts for this page load only.
      }
      return next;
    });
  }, []);

  return { collapsed, toggle };
};
