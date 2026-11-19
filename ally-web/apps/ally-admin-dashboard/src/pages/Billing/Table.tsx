import React from "react";

/** A column of the CR1 admin tables: its heading, its cell, and whether it is a number. */
export interface Column<T> {
  key: string;
  label: string;
  numeric?: boolean;
  cell: (row: T) => React.ReactNode;
}

/**
 * The CR1 admin table, as Costs' breakdown draws it: it scrolls inside its own box on a phone, so
 * the page never scrolls sideways.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  empty,
  onRowClick,
  testId,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  empty: string;
  onRowClick?: (row: T) => void;
  testId?: string;
}) {
  return (
    <div
      className="overflow-x-auto border border-border-light rounded-md max-w-full"
      data-testid={testId}
    >
      <table className="min-w-full text-sm">
        <thead className="bg-background-secondary text-left text-typography-700">
          <tr>
            {columns.map(column => (
              <th
                key={column.key}
                className={`px-3 py-2 font-medium ${column.numeric ? "text-right" : ""}`}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="px-3 py-4 text-typography-500">
                {empty}
              </td>
            </tr>
          )}
          {rows.map(row => (
            <tr
              key={rowKey(row)}
              className={`border-t border-border-light ${onRowClick ? "cursor-pointer hover:bg-background-secondary" : ""}`}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {columns.map(column => (
                <td
                  key={column.key}
                  className={`px-3 py-2 ${column.numeric ? "text-right tabular-nums whitespace-nowrap" : "min-w-[120px] break-words"}`}
                >
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A labelled number for an admin card. */
export const Stat: React.FC<{ label: string; value: React.ReactNode; testId?: string }> = ({
  label,
  value,
  testId,
}) => (
  <div className="min-w-0" data-testid={testId}>
    <p className="text-xs text-typography-500">{label}</p>
    <p className="text-lg text-typography-900 tabular-nums break-words">{value}</p>
  </div>
);

/** One audit line: when, who, what and why. */
export const HistoryList: React.FC<{
  entries: {
    action: string;
    note: string;
    createdAt: string;
    actorName?: string | null;
    actorEmail?: string | null;
  }[];
  empty: string;
}> = ({ entries, empty }) =>
  entries.length === 0 ? (
    <p className="text-sm text-typography-500">{empty}</p>
  ) : (
    <ul className="divide-y divide-border-light border border-border-light rounded-md">
      {entries.map((entry, index) => (
        <li key={`${entry.createdAt}-${index}`} className="px-3 py-2 text-sm">
          <p className="text-typography-900">
            <span className="font-medium">{entry.action.replace(/_/g, " ")}</span>
            {" · "}
            {entry.actorName || entry.actorEmail || "system"}
            {" · "}
            <span className="text-typography-500">
              {new Date(entry.createdAt).toLocaleString("en-GB", {
                day: "numeric",
                month: "short",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </p>
          {entry.note && <p className="text-typography-600 break-words">{entry.note}</p>}
        </li>
      ))}
    </ul>
  );

/** The server's own words when it refuses, else the fallback. */
export const serverMessage = (error: unknown, fallback: string): string => {
  const message = (error as { data?: { message?: unknown } })?.data?.message;
  if (typeof message === "string" && message) return message;
  if (Array.isArray(message) && message.length) return message.join(" ");
  return fallback;
};

/** A whole-number field: empty is `null` (unlimited); otherwise a number or NaN. */
export const parseLimit = (value: string): number | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed.replace(/,/g, ""));
  return Number.isInteger(n) && n >= 0 ? n : Number.NaN;
};
