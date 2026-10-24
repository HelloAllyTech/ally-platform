import React from "react";

import { useSelector } from "react-redux";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@ally-ui-mono/ui-shared";
import { useGetAllyGuideReleaseAuditQuery } from "@api";
import { ErrorPanel, LoadingBlock } from "@components/ally-guide/ConsoleStates";
import { InfoTip } from "@components/ally-guide/InfoTip";
import { Pill } from "@components/ally-guide/Pill";
import { en } from "@constants";
import { RootState } from "@store";
import { formatDateTime } from "@utils";

import { auditActor, describeAudit } from "./releaseAudit";

/** What the endpoint returns when no limit is sent, and the most a person is going to scroll. */
export const AUDIT_LIMIT = 50;

/**
 * Who changed which release, when and why, newest first: creation, promotion, rollback, and the
 * canary starting and stopping. An emergency action is set apart in words, not colour, so the
 * incident that needed one is easy to find afterwards. A failed load never hides the releases above.
 */
export const ReleaseAuditTrail: React.FC = () => {
  const strings = en.allyConsole.releases.audit;
  const currentUserId = useSelector((state: RootState) => state.user?.user?.id);
  const { data, isLoading, isError, error, refetch } = useGetAllyGuideReleaseAuditQuery({
    limit: AUDIT_LIMIT,
  });

  return (
    <section className="flex flex-col gap-2" data-testid="release-audit">
      <div className="flex items-center gap-1">
        <h3 className="text-xl font-normal text-typography-900">{strings.heading}</h3>
        <InfoTip label={strings.help} ariaLabel={`About ${strings.heading}`} />
      </div>
      {isLoading ? (
        <LoadingBlock lines={3} />
      ) : isError || !data ? (
        <ErrorPanel what="the release history" error={error} onRetry={() => void refetch()} />
      ) : data.length === 0 ? (
        <p className="py-2 text-sm text-typography-700" data-testid="release-audit-empty">
          {strings.none}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <Table className="w-full border-collapse text-left" data-testid="release-audit-table">
            <TableHead>
              <TableRow className="border-b border-border-light text-sm text-typography-700">
                <TableHeader className="py-3 pr-4 font-medium">{strings.columns.when}</TableHeader>
                <TableHeader className="py-3 pr-4 font-medium">{strings.columns.what}</TableHeader>
                <TableHeader className="py-3 pr-4 font-medium">{strings.columns.who}</TableHeader>
                <TableHeader className="py-3 pr-4 font-medium">
                  {strings.columns.reason}
                </TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.map(row => {
                const { text, emergency } = describeAudit(row, strings.wording);
                return (
                  <TableRow
                    key={row.id}
                    className="border-b border-border-light align-top text-sm text-typography-900"
                    data-testid="release-audit-row"
                  >
                    <TableCell className="whitespace-nowrap py-3 pr-4">
                      {formatDateTime(row.createdAt)}
                    </TableCell>
                    <TableCell className="py-3 pr-4">
                      <span className="inline-flex flex-wrap items-center gap-2">
                        {text}
                        {emergency && <Pill tone="danger">{strings.emergency}</Pill>}
                      </span>
                    </TableCell>
                    <TableCell className="py-3 pr-4">
                      {auditActor(row, currentUserId, strings.actors)}
                    </TableCell>
                    <TableCell className="max-w-md py-3 pr-4">
                      {row.reason ? (
                        <span className="line-clamp-2 break-words" title={row.reason}>
                          {row.reason}
                        </span>
                      ) : (
                        <span className="text-typography-700">{strings.noReason}</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
};
