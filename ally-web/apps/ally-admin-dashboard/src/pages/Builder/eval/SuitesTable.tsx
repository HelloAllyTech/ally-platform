import React from "react";

import {
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tag,
} from "@ally-ui-mono/ui-shared";
import { en } from "@constants";

import {
  formatEvalCost,
  formatJudgeScore,
  formatPassed,
  formatStarted,
  SUITE_STATUS_TAG_TYPE,
  SUITE_TRIGGER_TAG_TYPE,
  type SuiteRow,
} from "./evalFormat";

interface SuitesTableProps {
  rows: SuiteRow[];
  onOpen: (id: string) => void;
}

const dash = <span className="text-typography-400">—</span>;

/**
 * Suites, newest first. A running suite has no totals yet (the summary is
 * written when it settles), so it shows how many runs it is working through
 * rather than zeros that would read as a result.
 *
 * The verdict column is only for a prompt gate, the one kind of suite that
 * decides something: whether the proposed change passed, and whether it went
 * live. Opening a row is a button, not a click on the row, for the same reason
 * as the fixtures table: the cells hold Tags.
 */
export const SuitesTable: React.FC<SuitesTableProps> = ({ rows, onOpen }) => {
  const strings = en.builder.eval.suites;

  return (
    <div className="overflow-x-auto rounded border border-neutral-200">
      <Table size="md">
        <TableHead>
          <TableRow>
            <TableHeader>{strings.columnStarted}</TableHeader>
            <TableHeader>{strings.columnTrigger}</TableHeader>
            <TableHeader>{strings.columnStatus}</TableHeader>
            <TableHeader>{strings.columnPassed}</TableHeader>
            <TableHeader>{strings.columnGateViolations}</TableHeader>
            <TableHeader>{strings.columnCorrections}</TableHeader>
            <TableHeader>{strings.columnJudge}</TableHeader>
            <TableHeader>{strings.columnCost}</TableHeader>
            <TableHeader>{strings.columnVerdict}</TableHeader>
            <TableHeader />
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map(row => (
            <TableRow key={row.id}>
              <TableCell>
                <span className="whitespace-nowrap text-sm">{formatStarted(row.createdAt)}</span>
              </TableCell>
              <TableCell>
                <div className="flex flex-col items-start gap-0.5">
                  <Tag type={SUITE_TRIGGER_TAG_TYPE[row.trigger] ?? "cool-gray"} size="sm">
                    {en.builder.eval.trigger[row.trigger] ?? row.trigger}
                  </Tag>
                  {row.promptCode && (
                    <span className="max-w-[180px] truncate font-mono text-xs text-typography-500">
                      {row.promptCode}
                    </span>
                  )}
                </div>
              </TableCell>
              <TableCell>
                <Tag type={SUITE_STATUS_TAG_TYPE[row.status] ?? "cool-gray"} size="sm">
                  {en.builder.eval.suiteStatus[row.status] ?? row.status}
                </Tag>
              </TableCell>
              <TableCell>
                {row.runs === null ? (
                  row.status === "running" ? (
                    <span className="text-xs text-typography-600">
                      {strings.workingThrough(row.plannedRuns)}
                    </span>
                  ) : (
                    dash
                  )
                ) : (
                  <span className="tabular-nums">{formatPassed(row.passed, row.runs)}</span>
                )}
              </TableCell>
              <TableCell>
                {row.gateViolations === null ? (
                  dash
                ) : (
                  <span className="tabular-nums">{row.gateViolations}</span>
                )}
              </TableCell>
              <TableCell>
                {row.corrections === null ? (
                  dash
                ) : (
                  <span className="tabular-nums">{row.corrections}</span>
                )}
              </TableCell>
              <TableCell>
                <span className="tabular-nums">{formatJudgeScore(row.judgeScore)}</span>
              </TableCell>
              <TableCell>
                <span className="whitespace-nowrap tabular-nums">
                  {formatEvalCost(row.costUsd)}
                </span>
              </TableCell>
              <TableCell>
                {row.trigger !== "prompt_gate" ? (
                  dash
                ) : row.verdict === null ? (
                  <span className="text-xs text-typography-600">
                    {row.status === "running" ? strings.verdictPending : strings.verdictNone}
                  </span>
                ) : (
                  <div className="flex flex-col items-start gap-0.5">
                    <Tag type={row.verdict === "pass" ? "green" : "red"} size="sm">
                      {row.verdict === "pass" ? strings.verdictPass : strings.verdictFail}
                    </Tag>
                    <span className="text-xs text-typography-600">
                      {row.published
                        ? strings.published
                        : row.verdict === "pass"
                          ? strings.passedNotPublished
                          : strings.notPublished}
                    </span>
                  </div>
                )}
              </TableCell>
              <TableCell>
                <div className="flex justify-end">
                  <Button kind="ghost" size="sm" onClick={() => onOpen(row.id)}>
                    {strings.details}
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
};
