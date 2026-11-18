import React, { useEffect, useMemo, useRef, useState } from "react";

import { useLocation, useNavigate } from "react-router-dom";

import { en } from "@constants";
import { useUser } from "@hooks";
import { groupNavigationItems, isNavItemActive } from "@utils/navigation";

import { fuzzyFilter } from "./fuzzy";

interface CommandPaletteProps {
  recents: string[];
  onChoose: (id: string, path: string) => void;
  onClose: () => void;
}

interface Row {
  id: string;
  label: string;
  path: string;
  group: string;
  keywords: string[];
}

const LIST_ID = "command-palette-list";
const optionId = (id: string) => `command-palette-option-${id}`;

/**
 * Cmd/Ctrl+K: jump to any page the signed-in admin can see. Lists exactly the sidebar's visible
 * items (so it can never reveal a page the gates hide), with the last few visited on top while the
 * box is empty.
 */
export const CommandPalette: React.FC<CommandPaletteProps> = ({ recents, onChoose, onClose }) => {
  const { filteredNavigationItems } = useUser();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const location = useLocation();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const rows: Row[] = useMemo(() => {
    const sections = groupNavigationItems(filteredNavigationItems);
    return sections.flatMap(section =>
      section.items.map(item => ({
        id: item.id,
        label: item.label,
        path: item.path,
        group: section.label,
        keywords: [section.label],
      })),
    );
  }, [filteredNavigationItems]);

  const results: { row: Row; group: string }[] = useMemo(() => {
    if (query.trim()) {
      return fuzzyFilter(rows, query).map(row => ({ row, group: en.nav.palette.allPages }));
    }
    const byId = new Map(rows.map(row => [row.id, row]));
    const recentRows = recents
      .map(id => byId.get(id))
      .filter((row): row is Row => Boolean(row))
      // The page you are on is not a useful jump.
      .filter(
        row =>
          !isNavItemActive(
            { id: row.id, label: row.label, path: row.path },
            location.pathname,
            location.search,
          ),
      );
    const recentIds = new Set(recentRows.map(row => row.id));
    return [
      ...recentRows.map(row => ({ row, group: en.nav.palette.recent })),
      ...rows.filter(row => !recentIds.has(row.id)).map(row => ({ row, group: row.group })),
    ];
  }, [query, rows, recents, location.pathname, location.search]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  const choose = (index: number) => {
    const hit = results[index];
    if (hit) onChoose(hit.row.id, hit.row.path);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive(i => (results.length ? (i + 1) % results.length : 0));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive(i => (results.length ? (i - 1 + results.length) % results.length : 0));
    } else if (event.key === "Home") {
      event.preventDefault();
      setActive(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActive(Math.max(results.length - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(active);
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (event.key === "Tab") {
      // Focus stays in the box: the list is driven by the arrow keys.
      event.preventDefault();
    }
  };

  useEffect(() => {
    document
      .getElementById(results[active] ? optionId(results[active].row.id) : "")
      ?.scrollIntoView?.({
        block: "nearest",
      });
  }, [active, results]);

  let lastGroup = "";
  return (
    <div
      className="fixed inset-0 z-[1000] flex items-start justify-center bg-black/40 px-4 pt-[15vh]"
      data-testid="command-palette-overlay"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={en.nav.palette.title}
        className="w-full max-w-lg overflow-hidden rounded-lg border border-border-light bg-white shadow-2xl font-primary"
        onKeyDown={onKeyDown}
      >
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls={LIST_ID}
          aria-autocomplete="list"
          aria-activedescendant={results[active] ? optionId(results[active].row.id) : undefined}
          aria-label={en.nav.palette.title}
          placeholder={en.nav.palette.placeholder}
          value={query}
          onChange={event => setQuery(event.target.value)}
          className="w-full border-0 border-b border-border-light px-4 py-3 text-base text-typography-900 outline-none placeholder-typography-placeholder"
        />
        <ul
          id={LIST_ID}
          role="listbox"
          aria-label={en.nav.palette.allPages}
          className="max-h-[50vh] overflow-y-auto py-1"
        >
          {results.length === 0 && (
            <li role="presentation" className="px-4 py-6 text-center text-sm text-typography-600">
              {en.nav.palette.empty}
            </li>
          )}
          {results.map(({ row, group }, index) => {
            const showGroup = group !== lastGroup;
            lastGroup = group;
            return (
              <React.Fragment key={`${group}-${row.id}`}>
                {showGroup && (
                  <li
                    role="presentation"
                    className="px-4 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-typography-600"
                  >
                    {group}
                  </li>
                )}
                <li
                  id={optionId(row.id)}
                  role="option"
                  aria-selected={index === active}
                  onMouseMove={() => setActive(index)}
                  onClick={() => choose(index)}
                  className={`flex cursor-pointer items-center justify-between px-4 py-2 text-sm ${
                    index === active ? "bg-neutral-100 text-typography-900" : "text-typography-800"
                  }`}
                >
                  <span>{row.label}</span>
                  {query.trim() && <span className="text-xs text-typography-600">{row.group}</span>}
                </li>
              </React.Fragment>
            );
          })}
        </ul>
        <div className="border-t border-border-light px-4 py-2 text-xs text-typography-600">
          {en.nav.palette.hint}
        </div>
      </div>
    </div>
  );
};

/** Wires `onChoose` to the router so the provider stays free of navigation details. */
export const useChooseNavItem = (onDone: () => void, record: (id: string) => void) => {
  const navigate = useNavigate();
  return (id: string, path: string) => {
    record(id);
    onDone();
    navigate(path);
  };
};
