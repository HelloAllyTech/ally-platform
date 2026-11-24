import { createContext, useContext } from "react";

/**
 * True inside the staff support view (stage 8): the assistant home is shown for looking only.
 * Anything that changes the assistant or spends its owner's credits (Try it, Change your assistant,
 * the More menu, the inbox, every Add / Remove / Apply control) is absent. The home turns
 * `canEdit` and `canManage` off from this, and shared components may read it for their own
 * extra controls. The server is still what enforces read-only.
 */
export const ReadOnlyContext = createContext(false);
export const useReadOnly = (): boolean => useContext(ReadOnlyContext);
