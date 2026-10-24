import React, { useState } from "react";

import {
  Button,
  ContentSwitcher,
  InlineNotification,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@ally-ui-mono/ui-shared";
import { useGetAllyGuideReviewsQuery } from "@api";
import { EmptyPanel, ErrorPanel, LoadingBlock } from "@components/ally-guide/ConsoleStates";
import { InfoTip } from "@components/ally-guide/InfoTip";
import { Pill } from "@components/ally-guide/Pill";
import { en } from "@constants";
import { useAllyGuideAccess } from "@hooks";
import { formatDateTime } from "@utils";

import { ReviewPanel } from "./ReviewPanel";

const STATUSES = ["open", "done", "dismissed", "all"] as const;
type StatusFilter = (typeof STATUSES)[number];

/**
 * The review queue: windows the evaluator wants a person to label, safest first. The queue itself
 * is ids, reasons and check names, so anyone with the Console sees it; opening a review shows the
 * learner's redacted words and needs the transcripts grant, which this says rather than hiding the
 * button without a word.
 */
export const ReviewsPanel: React.FC = () => {
  const strings = en.allyConsole.evals.reviews;
  const { canReadTranscripts } = useAllyGuideAccess();
  const [status, setStatus] = useState<StatusFilter>("open");
  const [openId, setOpenId] = useState<string | null>(null);
  const { currentData, isError, error, refetch } = useGetAllyGuideReviewsQuery({ status });

  const header = (
    <>
      <div className="flex items-center gap-1">
        <h3 className="text-xl font-normal text-typography-900">{strings.heading}</h3>
        <InfoTip label={strings.help} ariaLabel="About the review queue" />
      </div>
      <ContentSwitcher
        size="md"
        selectedIndex={STATUSES.indexOf(status)}
        onChange={(event: { name?: string | number }) => setStatus(event.name as StatusFilter)}
        className="max-w-md"
        aria-label={strings.statusLabel}
      >
        {STATUSES.map(name => (
          <Switch key={name} name={name} text={strings.statuses[name]} />
        ))}
      </ContentSwitcher>
      {!canReadTranscripts && (
        <InlineNotification
          kind="info"
          lowContrast
          hideCloseButton
          title={strings.needsTranscripts}
          data-testid="reviews-locked"
        />
      )}
    </>
  );

  if (isError) {
    return <ErrorPanel what={strings.loadFailed} error={error} onRetry={() => void refetch()} />;
  }
  if (!currentData) {
    return (
      <div className="flex flex-col gap-4" data-testid="ally-reviews">
        {header}
        <LoadingBlock lines={5} />
      </div>
    );
  }

  const openCount = currentData.counts
    .filter(row => row.status === "open" || row.status === "claimed")
    .reduce((sum, row) => sum + row.n, 0);

  return (
    <div className="flex flex-col gap-4" data-testid="ally-reviews">
      {header}
      <p className="text-sm text-typography-800" data-testid="reviews-open-count">
        {strings.counts(openCount)}
      </p>

      {currentData.items.length === 0 ? (
        <EmptyPanel title={strings.emptyTitle} message={strings.emptyMessage} />
      ) : (
        <div className="overflow-x-auto">
          <Table className="w-full border-collapse text-left" data-testid="reviews-table">
            <TableHead>
              <TableRow className="border-b border-border-light text-sm text-typography-700">
                <TableHeader className="py-3 pr-4 font-medium">
                  {strings.columns.reason}
                </TableHeader>
                <TableHeader className="py-3 pr-4 font-medium">
                  {strings.columns.status}
                </TableHeader>
                <TableHeader className="py-3 pr-4 font-medium">{strings.columns.night}</TableHeader>
                <TableHeader className="py-3 pr-4 font-medium">
                  {strings.columns.checks}
                </TableHeader>
                <TableHeader className="py-3 pr-4 font-medium">
                  {strings.columns.queued}
                </TableHeader>
                <TableHeader className="py-3 pr-4 font-medium">
                  <span className="sr-only">Actions</span>
                </TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {currentData.items.map(item => {
                const reason = strings.reasons[item.reason] ?? item.reason;
                return (
                  <TableRow
                    key={item.id}
                    className="border-b border-border-light align-top text-sm text-typography-900"
                    data-testid="review-row"
                  >
                    <TableCell className="py-3 pr-4">
                      <span className="inline-flex items-center gap-1">
                        <Pill tone={item.reason === "safety_flag" ? "danger" : "neutral"}>
                          {reason}
                        </Pill>
                        {strings.reasonHelp[item.reason] && (
                          <InfoTip
                            label={strings.reasonHelp[item.reason]}
                            ariaLabel={`About ${reason}`}
                          />
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="py-3 pr-4">
                      {strings.statusNames[item.status] ?? item.status}
                    </TableCell>
                    <TableCell className="whitespace-nowrap py-3 pr-4">
                      {item.night ?? "—"}
                    </TableCell>
                    <TableCell className="py-3 pr-4 font-mono text-xs">
                      {item.failedChecks && item.failedChecks.length > 0
                        ? item.failedChecks.join(", ")
                        : strings.noChecks}
                    </TableCell>
                    <TableCell className="whitespace-nowrap py-3 pr-4">
                      {formatDateTime(item.createdAt)}
                    </TableCell>
                    <TableCell className="py-3 pr-4">
                      {canReadTranscripts && (
                        <Button
                          kind="tertiary"
                          size="sm"
                          aria-label={strings.reviewLabel(reason)}
                          onClick={() => setOpenId(item.id)}
                        >
                          {strings.review}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <ReviewPanel reviewId={openId} onClose={() => setOpenId(null)} />
    </div>
  );
};
