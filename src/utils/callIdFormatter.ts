/**
 * Formats a call ID into the standard format: #CAL-{year}-{callId}
 * @param callId - The unique identifier for the call
 * @param createdAt - The creation date of the call
 * @returns Formatted call ID string
 */
export const formatCallId = (
  callId?: string | number,
  createdAt?: string | number,
): string => {
  const year = new Date(createdAt || new Date()).getFullYear();
  return `#CAL-${year}-${callId}`;
};
