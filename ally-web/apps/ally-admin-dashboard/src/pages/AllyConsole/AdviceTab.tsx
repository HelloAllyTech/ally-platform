import React, { useState } from "react";

import { toast } from "sonner";

import {
  Button,
  ContentSwitcher,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TextArea,
} from "@ally-ui-mono/ui-shared";
import { useGetAllyGuideAdviceQuery, useModerateAllyGuideAdviceMutation } from "@api";
import { ConfirmDialog } from "@components/ally-guide/ConfirmDialog";
import { EmptyPanel, ErrorPanel, LoadingBlock } from "@components/ally-guide/ConsoleStates";
import { InfoTip } from "@components/ally-guide/InfoTip";
import { Pill } from "@components/ally-guide/Pill";
import { en } from "@constants";
import { useAllyGuideAccess } from "@hooks";
import { AllyGuideAdviceLine, AllyGuideAdviceStatus } from "@types";
import { formatDateTime, getErrorMessage } from "@utils";

const STATUSES: AllyGuideAdviceStatus[] = ["pending", "approved", "rejected"];
const LIMIT = 50;

/**
 * Moderation of the advice finishers leave at the mentor door. Nothing reaches a learner until it
 * is approved here, and the author is never part of what the API returns, so there is nothing to
 * show and nothing to leak. A decision can be changed later, so an approved line can still be
 * rejected and the other way round. Reading is for anyone with the Console; deciding needs the edit
 * grant and is hidden without it.
 */
export const AdviceTab: React.FC = () => {
  const strings = en.allyConsole.advice;
  const { canEdit } = useAllyGuideAccess();
  const [status, setStatus] = useState<AllyGuideAdviceStatus>("pending");
  const { currentData, isError, error, refetch } = useGetAllyGuideAdviceQuery({
    status,
    limit: LIMIT,
  });
  const [moderate] = useModerateAllyGuideAdviceMutation();

  const [workingId, setWorkingId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<AllyGuideAdviceLine | null>(null);
  const [reason, setReason] = useState("");

  const decide = async (
    line: AllyGuideAdviceLine,
    decision: "approve" | "reject",
    why?: string,
  ) => {
    setWorkingId(line.id);
    try {
      await moderate({ id: line.id, decision, reason: why }).unwrap();
      toast.success(decision === "approve" ? strings.approved : strings.rejected);
      return true;
    } catch (failure) {
      toast.error(getErrorMessage(failure, strings.failed));
      return false;
    } finally {
      setWorkingId(null);
    }
  };

  const closeReject = () => {
    setRejecting(null);
    setReason("");
  };

  const header = (
    <>
      <p className="max-w-3xl text-sm text-typography-700">{strings.intro}</p>
      <ContentSwitcher
        size="md"
        selectedIndex={STATUSES.indexOf(status)}
        onChange={(event: { name?: string | number }) =>
          setStatus(event.name as AllyGuideAdviceStatus)
        }
        className="max-w-md"
        aria-label={strings.filterLabel}
      >
        {STATUSES.map(name => (
          <Switch key={name} name={name} text={strings.statuses[name]} />
        ))}
      </ContentSwitcher>
    </>
  );

  if (isError) {
    return <ErrorPanel what="the advice" error={error} onRetry={() => void refetch()} />;
  }
  if (!currentData) {
    return (
      <div className="flex flex-col gap-4" data-testid="ally-advice">
        {header}
        <LoadingBlock lines={5} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="ally-advice">
      {header}

      {currentData.length === 0 ? (
        <EmptyPanel title={strings.emptyTitles[status]} message={strings.emptyMessage} />
      ) : (
        <div className="overflow-x-auto">
          <Table className="w-full border-collapse text-left" data-testid="ally-advice-table">
            <TableHead>
              <TableRow className="border-b border-border-light text-sm text-typography-700">
                <TableHeader className="py-3 pr-4 font-medium">
                  {strings.columns.advice}
                </TableHeader>
                <TableHeader className="py-3 pr-4 font-medium">
                  {strings.columns.course}
                </TableHeader>
                <TableHeader className="py-3 pr-4 font-medium">
                  {strings.columns.organisation}
                </TableHeader>
                <TableHeader className="py-3 pr-4 font-medium">{strings.columns.left}</TableHeader>
                <TableHeader className="py-3 pr-4 font-medium">
                  {strings.columns.decision}
                </TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {currentData.map(line => (
                <TableRow
                  key={line.id}
                  className="border-b border-border-light align-top text-sm text-typography-900"
                  data-testid="advice-row"
                >
                  <TableCell className="max-w-md py-3 pr-4">
                    <p className="whitespace-pre-wrap break-words" data-testid="advice-text">
                      {line.text}
                    </p>
                    {line.flags.length > 0 && (
                      <span className="mt-1 flex flex-wrap items-center gap-1">
                        {line.flags.map(flag => (
                          <Pill key={flag} tone="warning">
                            {strings.flags[flag] ?? strings.flagged(flag)}
                          </Pill>
                        ))}
                        <InfoTip label={strings.flagHelp} ariaLabel="About flags" />
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="py-3 pr-4">{line.trackTitle ?? strings.noCourse}</TableCell>
                  <TableCell className="py-3 pr-4">
                    {line.organisationName ?? strings.noOrganisation}
                  </TableCell>
                  <TableCell className="whitespace-nowrap py-3 pr-4">
                    {formatDateTime(line.createdAt)}
                  </TableCell>
                  <TableCell className="py-3 pr-4">
                    <div className="flex flex-col items-start gap-2">
                      {line.moderatedAt && (
                        <span className="text-xs text-typography-700">
                          {strings.decidedAt(formatDateTime(line.moderatedAt))}
                        </span>
                      )}
                      {line.rejectReason && (
                        <span className="text-xs text-typography-700">
                          {strings.reason(line.rejectReason)}
                        </span>
                      )}
                      {canEdit && (
                        <div className="flex flex-wrap gap-2">
                          {line.status !== "approved" && (
                            <Button
                              kind="primary"
                              size="sm"
                              aria-label={strings.approveLabel(line.text)}
                              disabled={workingId === line.id}
                              onClick={() => void decide(line, "approve")}
                            >
                              {strings.approve}
                            </Button>
                          )}
                          {line.status !== "rejected" && (
                            <Button
                              kind="danger--tertiary"
                              size="sm"
                              aria-label={strings.rejectLabel(line.text)}
                              disabled={workingId === line.id}
                              onClick={() => setRejecting(line)}
                            >
                              {strings.reject}
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {status !== "pending" && currentData.length > 0 && (
        <p className="text-xs text-typography-700">{strings.changeLater}</p>
      )}
      {currentData.length >= LIMIT && (
        <p className="text-xs text-typography-700" data-testid="advice-limit-note">
          {strings.limitNote(LIMIT)}
        </p>
      )}

      <ConfirmDialog
        isOpen={rejecting !== null}
        title={strings.rejectDialog.title}
        cancelLabel={strings.rejectDialog.cancel}
        confirmLabel={workingId ? strings.rejectDialog.working : strings.rejectDialog.confirm}
        danger
        isWorking={workingId !== null}
        onConfirm={() => {
          if (!rejecting) return;
          void decide(rejecting, "reject", reason).then(ok => {
            if (ok) closeReject();
          });
        }}
        onClose={closeReject}
      >
        <p>{strings.rejectDialog.body}</p>
        <TextArea
          id="ally-advice-reject-reason"
          labelText={strings.rejectDialog.reasonLabel}
          helperText={strings.rejectDialog.reasonHint}
          placeholder={strings.rejectDialog.reasonPlaceholder}
          rows={3}
          maxCount={200}
          enableCounter
          value={reason}
          onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) =>
            setReason(event.target.value)
          }
        />
      </ConfirmDialog>
    </div>
  );
};
