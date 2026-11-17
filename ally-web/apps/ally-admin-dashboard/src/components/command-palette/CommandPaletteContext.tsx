import { createContext, useContext } from "react";

export interface CommandPaletteApi {
  open: () => void;
  close: () => void;
  toggle: () => void;
}

const noop = () => undefined;

/** Outside a provider (tests, previews) the palette simply isn't there: every call is a no-op. */
export const CommandPaletteContext = createContext<CommandPaletteApi>({
  open: noop,
  close: noop,
  toggle: noop,
});

export const useCommandPalette = (): CommandPaletteApi => useContext(CommandPaletteContext);
