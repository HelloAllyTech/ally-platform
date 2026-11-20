import { createContext, useContext, useEffect } from "react";

export interface CommandPaletteApi {
  open: () => void;
  close: () => void;
  toggle: () => void;
  /**
   * A page with its own ⌘K / Ctrl+K search takes the chord while it is mounted, so one key press
   * opens one thing. Returns the release.
   */
  claimShortcut: () => () => void;
}

const noop = () => undefined;

/** Outside a provider (tests, previews) the palette simply isn't there: every call is a no-op. */
export const CommandPaletteContext = createContext<CommandPaletteApi>({
  open: noop,
  close: noop,
  toggle: noop,
  claimShortcut: () => noop,
});

export const useCommandPalette = (): CommandPaletteApi => useContext(CommandPaletteContext);

/** Take ⌘K / Ctrl+K away from the global palette for as long as the calling component is mounted. */
export const useClaimCommandPaletteShortcut = (): void => {
  const { claimShortcut } = useCommandPalette();
  useEffect(() => claimShortcut(), [claimShortcut]);
};
