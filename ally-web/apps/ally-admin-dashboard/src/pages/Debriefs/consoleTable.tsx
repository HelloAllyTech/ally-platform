import React from "react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@ally-ui-mono/ui-shared";

/** The console's plain table: header row plus rows, the same classes the calibration tab uses. */
export const ConsoleTable: React.FC<{
  headers: React.ReactNode[];
  rows: Array<{ key: string; cells: React.ReactNode[]; testId?: string }>;
  testId?: string;
}> = ({ headers, rows, testId }) => (
  <div className="overflow-x-auto">
    <Table className="w-full border-collapse text-left" data-testid={testId}>
      <TableHead>
        <TableRow className="border-b border-border-light text-sm text-typography-700">
          {headers.map((h, i) => (
            <TableHeader key={i} className="py-3 pr-4 font-medium">
              {h}
            </TableHeader>
          ))}
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.map(r => (
          <TableRow
            key={r.key}
            className="border-b border-border-light text-sm text-typography-900"
            data-testid={r.testId}
          >
            {r.cells.map((c, i) => (
              <TableCell key={i} className="py-3 pr-4 align-top">
                {c}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  </div>
);

export const formatWhen = (iso: string | null | undefined): string =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";

export const score = (v: number | string | null | undefined): string =>
  v === null || v === undefined || v === "" ? "—" : Number(v).toFixed(1);
