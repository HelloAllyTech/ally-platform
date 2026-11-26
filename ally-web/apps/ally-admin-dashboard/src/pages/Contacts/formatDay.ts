/**
 * "26 Nov 2026" from a calendar date ("YYYY-MM-DD"). Built from its parts rather than
 * `new Date(iso)`, which reads a bare date as UTC midnight and shows the previous day to anyone
 * west of Greenwich.
 */
export const formatDay = (isoDate: string): string => {
  const [year, month, day] = isoDate.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return isoDate;
  return new Date(year, month - 1, day).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};
