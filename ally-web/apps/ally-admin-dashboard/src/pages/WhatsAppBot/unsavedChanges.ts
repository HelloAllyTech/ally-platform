import { createContext, useContext, useEffect } from "react";

/**
 * How a tab tells the chatbot page it has unsaved edits, so moving to another tab or section (or
 * closing the page) asks first. Outside the chatbot page nothing is listening, and reporting is a
 * no-op.
 */
export type ReportUnsaved = (source: string, dirty: boolean) => void;

export const UnsavedChangesContext = createContext<ReportUnsaved>(() => undefined);

/** Report this tab's unsaved state while it is on screen; leaving the screen clears it. */
export const useReportUnsaved = (source: string, dirty: boolean): void => {
  const report = useContext(UnsavedChangesContext);
  useEffect(() => {
    report(source, dirty);
    return () => report(source, false);
  }, [report, source, dirty]);
};
