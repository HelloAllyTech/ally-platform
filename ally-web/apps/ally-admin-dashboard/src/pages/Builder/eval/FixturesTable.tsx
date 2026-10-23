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
import { ToggleSwitch } from "@components/toggle-switch";
import { en } from "@constants";

import type { FixtureRow } from "./evalFormat";

interface FixturesTableProps {
  rows: FixtureRow[];
  onOpen: (id: string) => void;
  onToggleActive: (id: string, active: boolean) => void;
  /** A fixture whose active flag is being saved: its switch waits. */
  pendingId?: string | null;
}

/**
 * The fixtures: one row each, with the facts a person scans for before running a
 * suite: is it active, does it have a checklist yet, and why is it in the set.
 *
 * No row click handler: the kind is a Carbon Tag and the active flag a switch,
 * and a control nested in a clickable row is two actions on one press. The name
 * and the Edit button open the panel instead.
 */
export const FixturesTable: React.FC<FixturesTableProps> = ({
  rows,
  onOpen,
  onToggleActive,
  pendingId = null,
}) => {
  const strings = en.builder.eval.fixtures;

  return (
    <div className="overflow-x-auto rounded border border-neutral-200">
      <Table size="md">
        <TableHead>
          <TableRow>
            <TableHeader>{strings.columnName}</TableHeader>
            <TableHeader>{strings.columnKind}</TableHeader>
            <TableHeader>{strings.columnChecklist}</TableHeader>
            <TableHeader>{strings.columnActive}</TableHeader>
            <TableHeader>{strings.columnNote}</TableHeader>
            <TableHeader />
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map(row => (
            <TableRow key={row.id}>
              <TableCell>
                <button
                  type="button"
                  className="max-w-[260px] truncate text-left text-sm font-medium text-primary-600 hover:underline"
                  title={row.name}
                  onClick={() => onOpen(row.id)}
                >
                  {row.name}
                </button>
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap items-center gap-1">
                  <Tag type={row.kind === "interview" ? "blue" : "purple"} size="sm">
                    {en.builder.eval.kind[row.kind] ?? row.kind}
                  </Tag>
                  {row.expectsNothingToBuild && (
                    <Tag type="cool-gray" size="sm">
                      {strings.expectsNothingToBuild}
                    </Tag>
                  )}
                </div>
              </TableCell>
              <TableCell>
                {row.checklistSize === null ? (
                  <span className="text-xs text-typography-500">
                    {strings.checklistNotApplicable}
                  </span>
                ) : row.checklistSize === 0 ? (
                  <span className="text-xs text-warning-text">{strings.checklistEmpty}</span>
                ) : (
                  <span className="tabular-nums">{row.checklistSize}</span>
                )}
              </TableCell>
              <TableCell>
                <ToggleSwitch
                  enabled={row.active}
                  disabled={pendingId === row.id}
                  label={strings.activeLabel(row.name)}
                  onChange={next => onToggleActive(row.id, next)}
                />
              </TableCell>
              <TableCell>
                <span className="block max-w-[320px] truncate text-xs text-typography-600">
                  {row.note || strings.noNote}
                </span>
              </TableCell>
              <TableCell>
                <div className="flex justify-end">
                  <Button kind="ghost" size="sm" onClick={() => onOpen(row.id)}>
                    {strings.edit}
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
