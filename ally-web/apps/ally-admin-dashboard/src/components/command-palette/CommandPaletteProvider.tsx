import React, { useCallback, useEffect, useMemo, useState } from "react";

import { useLocation } from "react-router-dom";

import { useUser } from "@hooks";
import { isNavItemActive } from "@utils/navigation";

import { CommandPalette, useChooseNavItem } from "./CommandPalette";
import { CommandPaletteContext } from "./CommandPaletteContext";
import { useRecentNavItems } from "./useRecentNavItems";

/** Owns the palette's open state and the Cmd/Ctrl+K shortcut, and keeps the recents list current. */
export const CommandPaletteProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isOpen, setIsOpen] = useState(false);
  const { recents, record } = useRecentNavItems();
  const { filteredNavigationItems } = useUser();
  const location = useLocation();

  const close = useCallback(() => setIsOpen(false), []);
  const open = useCallback(() => setIsOpen(true), []);
  const toggle = useCallback(() => setIsOpen(value => !value), []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setIsOpen(value => !value);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // Every page you land on counts as a recent, however you got there.
  useEffect(() => {
    const here = filteredNavigationItems.find(item =>
      isNavItemActive(item, location.pathname, location.search),
    );
    if (here) record(here.id);
  }, [location.pathname, location.search, filteredNavigationItems, record]);

  const api = useMemo(() => ({ open, close, toggle }), [open, close, toggle]);
  const choose = useChooseNavItem(close, record);

  return (
    <CommandPaletteContext.Provider value={api}>
      {children}
      {isOpen && <CommandPalette recents={recents} onChoose={choose} onClose={close} />}
    </CommandPaletteContext.Provider>
  );
};
