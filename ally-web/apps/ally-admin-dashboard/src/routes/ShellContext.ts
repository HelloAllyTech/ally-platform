import { createContext } from "react";

/**
 * True below `AdminShell`. A `PrivateLayout` inside it only gates (access / loading / failed);
 * outside it (the bare preview routes, older tests) it still draws the whole shell itself.
 */
export const ShellContext = createContext(false);
